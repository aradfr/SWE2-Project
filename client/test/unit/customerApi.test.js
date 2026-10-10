import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getServices, createTicket } from '../../src/api/customer.js'
import { apiFetch, ApiError } from '../../src/api/client.js'

// Unit under test: api/customer.js only. The shared apiFetch helper is mocked,
// so these tests check which request each function makes and what it returns.
// The real HTTP path (apiFetch + server) is covered by the integration tests.
vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ApiError: actual.ApiError, apiFetch: vi.fn() }
})

const services = [
  { tag: 'A', name: 'Payments', serviceTime: 3 },
  { tag: 'B', name: 'Banking', serviceTime: 5 },
]

const ticket = {
  id: 1,
  code: 'A001',
  serviceType: 'A',
  issuedAt: '2026-10-10T09:00:00.000Z',
  status: 'waiting',
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getServices', () => {
  // GET /api/services: no options, so apiFetch uses its default GET.
  it('requests /services with no options', async () => {
    apiFetch.mockResolvedValue({ services })
    await getServices()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/services')
  })

  // The list is unwrapped from the { services } response body.
  it('returns the services list', async () => {
    apiFetch.mockResolvedValue({ services })
    expect(await getServices()).toEqual(services)
  })

  // An office with no services gives an empty list, not an error.
  it('returns an empty list', async () => {
    apiFetch.mockResolvedValue({ services: [] })
    expect(await getServices()).toEqual([])
  })

  // Server errors reach the page unchanged, so it can show the message.
  it('propagates errors from apiFetch', async () => {
    const serverError = new ApiError(500, 'internal server error')
    apiFetch.mockRejectedValue(serverError)
    await expect(getServices()).rejects.toBe(serverError)
  })
})

describe('createTicket', () => {
  // POST /api/tickets with the NewTicket body { serviceType }.
  it('posts { serviceType } to /tickets', async () => {
    apiFetch.mockResolvedValue(ticket)
    await createTicket('A')
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/tickets', { method: 'POST', body: { serviceType: 'A' } })
  })

  // The created ticket is returned as received.
  it('returns the new ticket', async () => {
    apiFetch.mockResolvedValue(ticket)
    expect(await createTicket('A')).toEqual(ticket)
  })

  // The tag is sent exactly as given: validation is the server's job.
  it('sends the service tag unchanged', async () => {
    apiFetch.mockResolvedValue(ticket)
    await createTicket(' a ')
    expect(apiFetch).toHaveBeenCalledWith('/tickets', { method: 'POST', body: { serviceType: ' a ' } })
  })

  // Unknown service (404) and invalid request (400) reach the page unchanged.
  it.each([
    [404, 'Unknown service type: Z'],
    [400, 'serviceType is required'],
  ])('propagates ApiError %i', async (status, message) => {
    const apiError = new ApiError(status, message)
    apiFetch.mockRejectedValue(apiError)
    await expect(createTicket('Z')).rejects.toBe(apiError)
  })

  // Unreachable server: the network error is not swallowed.
  it('propagates network errors', async () => {
    const networkError = new Error('Cannot reach the server. Is it running?')
    apiFetch.mockRejectedValue(networkError)
    await expect(createTicket('A')).rejects.toBe(networkError)
  })
})
