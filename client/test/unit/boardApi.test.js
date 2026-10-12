/* Unit tests of the board functions in api/client.js: getBoard and
subscribeToBoardEvents. fetch and EventSource are replaced by fakes, so the
tests check the requests and how the events are passed to the page. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getBoard, subscribeToBoardEvents, ApiError } from '../../src/api/client.js'

const board = {
  A: { name: 'Payments', queueLength: 1, lastCalledTickets: [{ code: 'A001', counterId: 1, calledAt: '2026-10-11T09:30:00Z' }] },
}

// Minimal EventSource: records the URL and listeners, and lets a test emit events.
class FakeEventSource {
  static instances = []
  constructor(url) {
    this.url = url
    this.listeners = {}
    this.closed = false
    FakeEventSource.instances.push(this)
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener)
  }
  close() {
    this.closed = true
  }
  emit(type, data) {
    for (const listener of this.listeners[type] ?? []) listener({ type, data })
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('getBoard', () => {
  it('sends GET /api/board', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, board))
    vi.stubGlobal('fetch', fetchMock)
    await getBoard()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/board')
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined()
  })

  it('returns the board grouped by service tag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, board)))
    expect(await getBoard()).toEqual(board)
  })

  it('throws ApiError with the server message on an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { error: 'internal server error' })))
    const error = await getBoard().catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(500)
    expect(error.message).toBe('internal server error')
  })

  it('throws a clear error when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(getBoard()).rejects.toThrow('Cannot reach the server')
  })
})

describe('subscribeToBoardEvents', () => {
  it('opens one stream on /api/board/events', () => {
    subscribeToBoardEvents(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/board/events')
  })

  it('listens to board-state, ticket-issued and ticket-called', () => {
    subscribeToBoardEvents(vi.fn())
    expect(Object.keys(FakeEventSource.instances[0].listeners).sort())
      .toEqual(['board-state', 'ticket-called', 'ticket-issued'])
  })

  it('passes the event name and the parsed JSON data', () => {
    const onEvent = vi.fn()
    subscribeToBoardEvents(onEvent)
    FakeEventSource.instances[0].emit('board-state', JSON.stringify(board))
    expect(onEvent).toHaveBeenCalledWith('board-state', board)
  })

  it('reports data that is not JSON to onError, not to onEvent', () => {
    const onEvent = vi.fn()
    const onError = vi.fn()
    subscribeToBoardEvents(onEvent, onError)
    FakeEventSource.instances[0].emit('board-state', 'not json')
    expect(onEvent).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(SyntaxError)
  })

  it('reports an error thrown by onEvent to onError', () => {
    const onError = vi.fn()
    const failure = new Error('render failed')
    subscribeToBoardEvents(() => { throw failure }, onError)
    FakeEventSource.instances[0].emit('ticket-called', '{}')
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('works without an onError callback', () => {
    subscribeToBoardEvents(vi.fn())
    expect(() => FakeEventSource.instances[0].emit('board-state', 'not json')).not.toThrow()
  })

  it('closes the stream when the returned function is called', () => {
    const unsubscribe = subscribeToBoardEvents(vi.fn())
    expect(FakeEventSource.instances[0].closed).toBe(false)
    unsubscribe()
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })
})
