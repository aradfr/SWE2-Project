/* Unit tests of routes/board.js. The board service is mocked, so each test
decides what the board contains and when the read finishes; events.js is the
real one. GET /api/board goes through Supertest. The SSE stream needs a real
server: the test app listens on a random port and the stream is read with fetch. */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import express from 'express'
import request from 'supertest'
import boardRouter from '../../src/routes/board.js'
import { errorHandler } from '../../src/middleware/errorHandler.js'
import { BOARD_EVENTS, publishBoardEvent } from '../../src/events.js'
import { getBoardState } from '../../src/services/boardService.js'

vi.mock('../../src/services/boardService.js', () => ({ getBoardState: vi.fn() }))

const app = express()
app.use('/api/board', boardRouter)
app.use(errorHandler)

const emptyBoard = { A: { name: 'Payments', queueLength: 0, lastCalledTickets: [] } }
const boardWith = (queueLength) => ({ A: { name: 'Payments', queueLength, lastCalledTickets: [] } })

let server
let baseUrl
const streams = []

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (streams.length) streams.pop().close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

// Opens the SSE stream; nextEvent() waits for the next event, comments() lists keep-alives.
async function openStream() {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/api/board/events`, { signal: controller.signal })
  const stream = { response, close: () => controller.abort() }
  streams.push(stream)
  if (!response.body || response.status !== 200) return stream

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const comments = []
  stream.comments = () => comments
  stream.nextEvent = async () => {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end !== -1) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (block.startsWith(':')) {
          comments.push(block)
          continue
        }
        return {
          event: block.match(/^event: (.*)$/m)?.[1],
          data: JSON.parse(block.match(/^data: (.*)$/m)?.[1]),
        }
      }
      const { value, done } = await reader.read()
      if (done) return null // stream ended by the server
      buffer += decoder.decode(value, { stream: true })
    }
  }
  return stream
}

describe('GET /api/board', () => {
  it('returns the board state as JSON', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const res = await request(app).get('/api/board').expect(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual(emptyBoard)
  })

  it('answers 500 with the Error body when the board cannot be read', async () => {
    getBoardState.mockRejectedValue(new Error('SQLITE_BUSY'))
    const res = await request(app).get('/api/board').expect(500)
    expect(res.body).toEqual({ error: 'internal server error' })
  })
})

describe('GET /api/board/events', () => {
  it('answers with an event stream that is not cached', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const { response } = await openStream()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/)
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
  })

  it('sends the current board as the first board-state event', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const stream = await openStream()
    expect(await stream.nextEvent()).toEqual({ event: 'board-state', data: emptyBoard })
  })

  it('sends the new board after every published event', async () => {
    getBoardState.mockResolvedValueOnce(boardWith(0))
    const stream = await openStream()
    await stream.nextEvent()

    getBoardState.mockResolvedValueOnce(boardWith(1))
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, { code: 'A001' })
    expect(await stream.nextEvent()).toEqual({ event: 'board-state', data: boardWith(1) })

    getBoardState.mockResolvedValueOnce(boardWith(0))
    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, { code: 'A001', counterId: 1 })
    expect(await stream.nextEvent()).toEqual({ event: 'board-state', data: boardWith(0) })
  })

  it('sends every update to all the open streams', async () => {
    getBoardState.mockResolvedValue(boardWith(0))
    const first = await openStream()
    const second = await openStream()
    await first.nextEvent()
    await second.nextEvent()

    getBoardState.mockResolvedValue(boardWith(3))
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})

    expect((await first.nextEvent()).data).toEqual(boardWith(3))
    expect((await second.nextEvent()).data).toEqual(boardWith(3))
  })

  it('does not lose an event published while the first board is loading', async () => {
    let finishFirstRead
    getBoardState
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstRead = resolve }))
      .mockResolvedValue(boardWith(1))

    const streamPromise = openStream()
    await vi.waitFor(() => expect(finishFirstRead).toBeTypeOf('function'))
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {}) // arrives before the first board-state
    finishFirstRead(boardWith(0))

    const stream = await streamPromise
    expect((await stream.nextEvent()).data).toEqual(boardWith(0))
    expect((await stream.nextEvent()).data).toEqual(boardWith(1))
  })

  it('answers 500 when the first board cannot be read, and stops listening', async () => {
    getBoardState.mockRejectedValue(new Error('SQLITE_BUSY'))
    const { response } = await openStream()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal server error' })

    getBoardState.mockClear()
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    await tick()
    expect(getBoardState).not.toHaveBeenCalled()
  })

  it('stops reading the board when the client disconnects', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const stream = await openStream()
    await stream.nextEvent()

    stream.close()
    await tick()
    getBoardState.mockClear()
    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, {})
    await tick()
    expect(getBoardState).not.toHaveBeenCalled()
  })

  it('ends the stream when an update cannot be read', async () => {
    getBoardState.mockResolvedValueOnce(emptyBoard).mockRejectedValueOnce(new Error('SQLITE_BUSY'))
    const stream = await openStream()
    await stream.nextEvent()

    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    expect(await stream.nextEvent()).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })

  it('sends a keep-alive comment every 20 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    getBoardState.mockResolvedValue(emptyBoard)
    const stream = await openStream()
    await stream.nextEvent()

    vi.advanceTimersByTime(20000)
    getBoardState.mockResolvedValue(boardWith(1))
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {}) // next event, read after the comment
    await stream.nextEvent()

    expect(stream.comments()).toEqual([': keep-alive'])
  })
})

// Cases that depend on the exact moment a client goes away: a fake response
// lets each test decide when it is destroyed. The handler is the real one.
const eventsHandler = boardRouter.stack
  .find((layer) => layer.route?.path === '/events')
  .route.stack[0].handle

class FakeResponse extends EventEmitter {
  headersSent = false
  writableEnded = false
  destroyed = false
  writes = []
  status(code) { this.statusCode = code; return this }
  set(headers) { this.headers = headers; return this }
  flushHeaders() { this.headersSent = true }
  write(chunk) { this.writes.push(chunk); return true }
  end() { this.writableEnded = true }
}

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('GET /api/board/events, client leaving at a bad moment', () => {
  // Let the server see the streams closed by the previous tests.
  beforeEach(() => tick(100))

  it('sends nothing if the client left while the first board was loading', async () => {
    const read = deferred()
    getBoardState.mockReturnValueOnce(read.promise)
    const res = new FakeResponse()

    const handled = eventsHandler({}, res)
    res.destroyed = true
    res.emit('close')
    read.resolve(emptyBoard)
    await handled

    expect(res.headersSent).toBe(false)
    expect(res.writes).toEqual([])
  })

  it('skips a queued update if the client is already gone', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const res = new FakeResponse()
    await eventsHandler({}, res)
    getBoardState.mockClear()

    res.destroyed = true // 'close' not emitted yet: the listener is still there
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    await tick()

    expect(getBoardState).not.toHaveBeenCalled()
    expect(res.writes).toHaveLength(1) // only the first board-state
    res.emit('close')
  })

  it('does not write an update that arrives after the client left', async () => {
    getBoardState.mockResolvedValueOnce(emptyBoard)
    const res = new FakeResponse()
    await eventsHandler({}, res)

    const read = deferred()
    getBoardState.mockReturnValueOnce(read.promise)
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    await vi.waitFor(() => expect(getBoardState).toHaveBeenCalledTimes(2))
    res.destroyed = true
    read.resolve(boardWith(1))
    await tick()

    expect(res.writes).toHaveLength(1)
    res.emit('close')
  })

  it('does not end a response that is already destroyed when an update fails', async () => {
    getBoardState.mockResolvedValueOnce(emptyBoard)
    const res = new FakeResponse()
    await eventsHandler({}, res)

    const read = deferred()
    getBoardState.mockReturnValueOnce(read.promise)
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    await vi.waitFor(() => expect(getBoardState).toHaveBeenCalledTimes(2))
    res.destroyed = true
    read.reject(new Error('SQLITE_BUSY'))
    await tick()

    expect(console.error).toHaveBeenCalled()
    expect(res.writableEnded).toBe(false)
  })

  it('does not send a keep-alive to a destroyed response', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    getBoardState.mockResolvedValue(emptyBoard)
    const res = new FakeResponse()
    await eventsHandler({}, res)

    res.destroyed = true
    vi.advanceTimersByTime(20000)

    expect(res.writes).toHaveLength(1)
    res.emit('close')
  })

  it('ends the stream if the first board cannot be written', async () => {
    getBoardState.mockResolvedValue(emptyBoard)
    const res = new FakeResponse()
    const failure = new Error('socket hang up')
    res.write = () => { throw failure }

    await expect(eventsHandler({}, res)).resolves.toBeUndefined()

    expect(res.headersSent).toBe(true)
    expect(console.error).toHaveBeenCalledWith(failure)
    expect(res.writableEnded).toBe(true)
    getBoardState.mockClear()
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})
    await tick()
    expect(getBoardState).not.toHaveBeenCalled() // no longer listening
  })
})
