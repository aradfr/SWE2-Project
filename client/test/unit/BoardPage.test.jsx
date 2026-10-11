/* Unit tests of the display board page (BoardPage, Call customer story).
api/client.js is mocked: each test decides what getBoard returns and sends
events through the onEvent / onError callbacks the page registers. The tests
check what a person in the waiting room sees (roles and visible text). */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import BoardPage from '../../src/pages/board/BoardPage.jsx'
import { getBoard, subscribeToBoardEvents } from '../../src/api/client.js'

vi.mock('../../src/api/client.js', () => ({
  getBoard: vi.fn(),
  subscribeToBoardEvents: vi.fn(),
}))

const board = {
  A: {
    name: 'Payments',
    queueLength: 1,
    lastCalledTickets: [
      { code: 'A001', counterId: 1, calledAt: '2026-10-11T09:30:00Z' },
      { code: 'A002', counterId: 2, calledAt: '2026-10-11T09:31:00Z' },
    ],
  },
  B: { name: 'Banking', queueLength: 2, lastCalledTickets: [] },
  C: { name: 'Shipping', queueLength: 0, lastCalledTickets: [] },
}

let stream // callbacks registered by the page
let unsubscribe

beforeEach(() => {
  vi.resetAllMocks()
  unsubscribe = vi.fn()
  subscribeToBoardEvents.mockImplementation((onEvent, onError) => {
    stream = { onEvent, onError }
    return unsubscribe
  })
})

afterEach(() => {
  vi.useRealTimers()
})

const card = (name) => screen.getByRole('heading', { name }).closest('article')

describe('loading', () => {
  it('shows a loading indicator until the board arrives', async () => {
    getBoard.mockReturnValue(new Promise(() => {}))
    render(<BoardPage />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByRole('heading', { name: 'Payments' })).not.toBeInTheDocument()
  })

  it('reads the board and opens the event stream once', async () => {
    getBoard.mockResolvedValue(board)
    render(<BoardPage />)
    await screen.findByRole('heading', { name: 'Payments' })
    expect(getBoard).toHaveBeenCalledTimes(1)
    expect(subscribeToBoardEvents).toHaveBeenCalledTimes(1)
  })
})

describe('board content', () => {
  beforeEach(async () => {
    getBoard.mockResolvedValue(board)
    render(<BoardPage />)
    await screen.findByRole('heading', { name: 'Payments' })
  })

  it('shows the page title', () => {
    expect(screen.getByRole('heading', { level: 1, name: 'Display board' })).toBeInTheDocument()
  })

  it('shows one card per service, in the server order', () => {
    const names = screen.getAllByRole('article').map((article) => within(article).getByRole('heading').textContent)
    expect(names).toEqual(['Payments', 'Banking', 'Shipping'])
  })

  it('shows the service tag on each card', () => {
    expect(within(card('Payments')).getByText('A')).toBeInTheDocument()
    expect(within(card('Shipping')).getByText('C')).toBeInTheDocument()
  })

  it('shows the last ticket called by each counter', () => {
    const payments = within(card('Payments'))
    expect(payments.getByText('Counter 1')).toBeInTheDocument()
    expect(payments.getByText('A001')).toBeInTheDocument()
    expect(payments.getByText('Counter 2')).toBeInTheDocument()
    expect(payments.getByText('A002')).toBeInTheDocument()
  })

  it('says when no ticket of a service has been called', () => {
    expect(within(card('Banking')).getByText('No ticket called yet')).toBeInTheDocument()
    expect(within(card('Payments')).queryByText('No ticket called yet')).not.toBeInTheDocument()
  })

  it('shows the length of each queue', () => {
    expect(within(card('Payments')).getByText('1')).toBeInTheDocument()
    expect(within(card('Banking')).getByText('2')).toBeInTheDocument()
    expect(within(card('Shipping')).getByText('0')).toBeInTheDocument()
  })
})

describe('live updates', () => {
  beforeEach(async () => {
    getBoard.mockResolvedValue(board)
    render(<BoardPage />)
    await screen.findByRole('heading', { name: 'Payments' })
  })

  it('shows the board sent in a board-state event, without a new request', () => {
    const updated = {
      ...board,
      C: { name: 'Shipping', queueLength: 0, lastCalledTickets: [{ code: 'C001', counterId: 3, calledAt: '2026-10-11T09:40:00Z' }] },
    }
    act(() => stream.onEvent('board-state', updated))
    expect(within(card('Shipping')).getByText('C001')).toBeInTheDocument()
    expect(within(card('Shipping')).getByText('Counter 3')).toBeInTheDocument()
    expect(getBoard).toHaveBeenCalledTimes(1)
  })

  it('reloads the board for other events', async () => {
    getBoard.mockResolvedValue({ ...board, B: { ...board.B, queueLength: 3 } })
    act(() => stream.onEvent('ticket-issued', { code: 'B003' }))
    await waitFor(() => expect(within(card('Banking')).getByText('3')).toBeInTheDocument())
    expect(getBoard).toHaveBeenCalledTimes(2)
  })

  it('shows a stream error in an alert and keeps the board', () => {
    act(() => stream.onError(new Error('Unexpected token')))
    expect(screen.getByRole('alert')).toHaveTextContent('Unexpected token')
    expect(screen.getByRole('heading', { name: 'Payments' })).toBeInTheDocument()
  })

  it('removes the alert when a new board arrives', () => {
    act(() => stream.onError(new Error('Unexpected token')))
    act(() => stream.onEvent('board-state', board))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('errors', () => {
  it('shows the error in an alert when the first load fails', async () => {
    getBoard.mockRejectedValue(new Error('Cannot reach the server. Is it running?'))
    render(<BoardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('uses a default message when the error has none', async () => {
    getBoard.mockRejectedValue(new Error(''))
    render(<BoardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the board.')
  })

  it('keeps the last board when a reload fails', async () => {
    getBoard.mockResolvedValueOnce(board).mockRejectedValueOnce(new Error('internal server error'))
    render(<BoardPage />)
    await screen.findByRole('heading', { name: 'Payments' })

    act(() => stream.onEvent('ticket-called', {}))
    expect(await screen.findByRole('alert')).toHaveTextContent('internal server error')
    expect(within(card('Payments')).getByText('A001')).toBeInTheDocument()
  })
})

describe('refresh and cleanup', () => {
  it('ignores an older answer that arrives after a board-state event', async () => {
    let finishOld
    getBoard
      .mockResolvedValueOnce(board) // first load
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    render(<BoardPage />)
    await screen.findByRole('heading', { name: 'Payments' })

    act(() => stream.onEvent('ticket-issued', {})) // a request that stays pending (like the polling)
    const newer = { ...board, B: { ...board.B, queueLength: 3 } }
    act(() => stream.onEvent('board-state', newer))
    expect(within(card('Banking')).getByText('3')).toBeInTheDocument()

    await act(async () => finishOld(board)) // old answer: B = 2
    expect(within(card('Banking')).getByText('3')).toBeInTheDocument()
  })

  it('reloads the board every 5 seconds', async () => {
    vi.useFakeTimers()
    getBoard.mockResolvedValue(board)
    render(<BoardPage />)
    expect(getBoard).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(getBoard).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(getBoard).toHaveBeenCalledTimes(3)
  })

  it('shows only the answer of the latest request', async () => {
    let finishOld
    getBoard
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ ...board, B: { ...board.B, queueLength: 7 } })
    render(<BoardPage />)

    act(() => stream.onEvent('ticket-issued', {})) // second request, answered first
    await waitFor(() => expect(within(card('Banking')).getByText('7')).toBeInTheDocument())

    await act(async () => finishOld(board)) // old answer arrives late
    expect(within(card('Banking')).getByText('7')).toBeInTheDocument()
  })

  it('closes the stream and stops reloading when the page is left', async () => {
    vi.useFakeTimers()
    getBoard.mockResolvedValue(board)
    const { unmount } = render(<BoardPage />)
    unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15000)
    expect(getBoard).toHaveBeenCalledTimes(1)
  })

  it('ignores an answer that arrives after the page is left', async () => {
    let finish
    getBoard.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const consoleError = vi.spyOn(console, 'error')
    const { unmount } = render(<BoardPage />)
    unmount()
    await act(async () => finish(board))
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('ignores an error that arrives after the page is left', async () => {
    let fail
    getBoard.mockImplementation(() => new Promise((resolve, reject) => { fail = reject }))
    const consoleError = vi.spyOn(console, 'error')
    const { unmount } = render(<BoardPage />)
    unmount()
    await act(async () => fail(new Error('internal server error')))
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('ignores the error of an older request when a newer one succeeded', async () => {
    let failOld
    getBoard
      .mockImplementationOnce(() => new Promise((resolve, reject) => { failOld = reject }))
      .mockResolvedValueOnce(board)
    render(<BoardPage />)

    act(() => stream.onEvent('ticket-called', {}))
    await screen.findByRole('heading', { name: 'Payments' })

    await act(async () => failOld(new Error('internal server error')))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores a stream error that arrives after the page is left', () => {
    getBoard.mockReturnValue(new Promise(() => {}))
    const consoleError = vi.spyOn(console, 'error')
    const { unmount } = render(<BoardPage />)
    unmount()
    stream.onError(new Error('connection lost'))
    expect(consoleError).not.toHaveBeenCalled()
  })
})
