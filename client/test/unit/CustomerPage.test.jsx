// Unit tests for the "Get ticket" customer page (CustomerPage, task OQM-15).
// The page itself is built separately: these tests are the agreed contract.
// They check behaviour only, the way a customer sees it (roles and visible
// text), so layout, styling and wording are free. The page must:
//   1. load services with getServices() from api/customer.js
//   2. show a loading indicator (role "status") while loading
//   3. show one button per service, labelled with the service name
//   4. on click, call createTicket(tag) from api/customer.js
//   5. disable the service buttons while the ticket is being created
//   6. show the returned ticket code (e.g. A001) on success
//   7. show the server error message in an alert (role "alert") on failure
// These tests fail on the placeholder page and pass once the page follows
// the contract above.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CustomerPage from '../../src/pages/customer/CustomerPage.jsx'
import { getServices, createTicket } from '../../src/api/customer.js'
import { ApiError } from '../../src/api/client.js'

vi.mock('../../src/api/customer.js', () => ({
  getServices: vi.fn(),
  createTicket: vi.fn(),
}))

const services = [
  { tag: 'A', name: 'Payments', serviceTime: 3 },
  { tag: 'B', name: 'Banking', serviceTime: 5 },
  { tag: 'C', name: 'Shipping', serviceTime: 10 },
]

const ticketFor = (tag, n = 1) => ({
  id: n,
  code: `${tag}${String(n).padStart(3, '0')}`,
  serviceType: tag,
  issuedAt: '2026-10-10T09:00:00.000Z',
  status: 'waiting',
})

// A promise the test resolves by hand, to observe in-between states.
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/customer']}>
      <CustomerPage />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const serviceButton = (name) => screen.findByRole('button', { name: new RegExp(name, 'i') })

beforeEach(() => {
  vi.resetAllMocks()
  getServices.mockResolvedValue(services)
})

describe('CustomerPage: services', () => {
  // 1 + 3: every service from the API becomes a button with its name.
  it('shows one button per service, with its name', async () => {
    renderPage()
    for (const { name } of services) {
      expect(await serviceButton(name)).toBeEnabled()
    }
    expect(getServices).toHaveBeenCalled()
  })

  // 2: something tells the customer the services are loading.
  it('shows a loading indicator until the services arrive', async () => {
    const load = deferred()
    getServices.mockReturnValue(load.promise)
    renderPage()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /payments/i })).not.toBeInTheDocument()

    load.resolve(services)
    expect(await serviceButton('Payments')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  // 7: if the services cannot be loaded, the customer sees why.
  it('shows the error when the services cannot be loaded', async () => {
    getServices.mockRejectedValue(new Error('Cannot reach the server. Is it running?'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Cannot reach the server. Is it running?')
    expect(screen.queryByRole('button', { name: /payments/i })).not.toBeInTheDocument()
  })
})

describe('CustomerPage: taking a ticket', () => {
  // 4 + 6: main scenario of the story.
  it('takes a ticket for the selected service and shows its code', async () => {
    createTicket.mockResolvedValue(ticketFor('B'))
    const user = renderPage()

    await user.click(await serviceButton('Banking'))

    expect(createTicket).toHaveBeenCalledTimes(1)
    expect(createTicket).toHaveBeenCalledWith('B')
    expect(await screen.findByText('B001')).toBeInTheDocument()
  })

  // 4: each button sends its own service tag, not the name.
  it.each(services.map((s) => [s.name, s.tag]))('the %s button requests service %s', async (name, tag) => {
    createTicket.mockResolvedValue(ticketFor(tag))
    const user = renderPage()
    await user.click(await serviceButton(name))
    expect(createTicket).toHaveBeenCalledWith(tag)
    expect(await screen.findByText(`${tag}001`)).toBeInTheDocument()
  })

  // 5: no double tickets from impatient double clicks.
  it('disables the service buttons while the ticket is being created', async () => {
    const pending = deferred()
    createTicket.mockReturnValue(pending.promise)
    const user = renderPage()

    await user.click(await serviceButton('Payments'))

    for (const { name } of services) {
      expect(screen.getByRole('button', { name: new RegExp(name, 'i') })).toBeDisabled()
    }
    await user.click(screen.getByRole('button', { name: /payments/i }))
    expect(createTicket).toHaveBeenCalledTimes(1)

    pending.resolve(ticketFor('A'))
    expect(await screen.findByText('A001')).toBeInTheDocument()
  })

  // 7: unknown service or invalid request -> the server message is shown.
  it.each([
    [404, 'Unknown service type: A'],
    [400, 'serviceType is required'],
    [500, 'internal server error'],
  ])('shows the server error message on %i', async (status, message) => {
    createTicket.mockRejectedValue(new ApiError(status, message))
    const user = renderPage()

    await user.click(await serviceButton('Payments'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(screen.queryByText('A001')).not.toBeInTheDocument()
  })

  // 7: after a failure the customer can try again.
  it('lets the customer retry after an error', async () => {
    createTicket
      .mockRejectedValueOnce(new Error('Cannot reach the server. Is it running?'))
      .mockResolvedValueOnce(ticketFor('A'))
    const user = renderPage()

    await user.click(await serviceButton('Payments'))
    await screen.findByRole('alert')
    await user.click(await serviceButton('Payments'))

    expect(await screen.findByText('A001')).toBeInTheDocument()
    expect(createTicket).toHaveBeenCalledTimes(2)
  })

  // 6: the code shown is the one returned by the server, not computed by the page.
  it('shows exactly the code returned by the server', async () => {
    createTicket.mockResolvedValue(ticketFor('C', 42))
    const user = renderPage()
    await user.click(await serviceButton('Shipping'))
    const code = await screen.findByText('C042')
    expect(within(document.body).queryByText('C001')).not.toBeInTheDocument()
    expect(code).toBeVisible()
  })
})
