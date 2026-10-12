/* Integration tests of the Board API (Call customer story).
The real Express app, services and store are used, with SQLite on a temporary
file. GET /api/board goes through Supertest; the SSE stream needs a real
server, so the app listens on a random port and the stream is read with fetch. */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { reset, close } from '../../src/store.js'
import { subscribeToBoardEvents } from '../../src/events.js'

const dbPath = path.join(os.tmpdir(), `oqm-board-${process.pid}-${Date.now()}.db`)

let server
let baseUrl

beforeAll(async () => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

beforeEach(async () => {
  await reset()
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await close()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(`${dbPath}${suffix}`, { force: true })
  }
})

const getTicket = (serviceType) => request(app).post('/api/tickets').send({ serviceType })
const callNext = (id) => request(app).post(`/api/counters/${id}/next`)
const getBoard = async () => (await request(app).get('/api/board').expect(200)).body

async function getTickets(serviceType, count) {
  for (let i = 0; i < count; i++) await getTicket(serviceType).expect(201)
}

// Opens the SSE stream and returns a function that waits for the next event.
async function openBoardStream() {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/api/board/events`, { signal: controller.signal })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  async function nextEvent() {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end !== -1) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (block.startsWith(':')) continue // keep-alive comment
        const event = block.match(/^event: (.*)$/m)?.[1]
        const data = block.match(/^data: (.*)$/m)?.[1]
        return { event, data: JSON.parse(data) }
      }
      const { value, done } = await reader.read()
      if (done) throw new Error('stream closed')
      buffer += decoder.decode(value, { stream: true })
    }
  }

  return { response, nextEvent, close: () => controller.abort() }
}

describe('GET /api/board', () => {
  it('shows every service with empty queues after the reset', async () => {
    expect(await getBoard()).toEqual({
      A: { name: 'Payments', queueLength: 0, lastCalledTickets: [] },
      B: { name: 'Banking', queueLength: 0, lastCalledTickets: [] },
      C: { name: 'Shipping', queueLength: 0, lastCalledTickets: [] },
    })
  })

  it('counts the waiting tickets of each service', async () => {
    await getTickets('A', 2)
    await getTickets('C', 1)

    const board = await getBoard()
    expect(board.A.queueLength).toBe(2)
    expect(board.B.queueLength).toBe(0)
    expect(board.C.queueLength).toBe(1)
  })

  it('shows the called ticket with its counter and removes it from the queue', async () => {
    await getTickets('A', 2)
    await callNext(1).expect(200)

    const board = await getBoard()
    expect(board.A.queueLength).toBe(1)
    expect(board.A.lastCalledTickets).toEqual([
      { code: 'A001', counterId: 1, calledAt: expect.stringMatching(/Z$/) },
    ])
  })

  it('shows one call per counter, ordered by counter', async () => {
    await getTickets('A', 3)
    await callNext(2).expect(200)
    await callNext(1).expect(200)

    const { A } = await getBoard()
    expect(A.lastCalledTickets.map(({ code, counterId }) => ({ code, counterId }))).toEqual([
      { code: 'A002', counterId: 1 },
      { code: 'A001', counterId: 2 },
    ])
  })

  it('keeps only the last call of a counter, also across services', async () => {
    await getTickets('A', 1)
    await getTickets('B', 2)
    await callNext(2).expect(200) // B001: B is the longest queue
    await callNext(2).expect(200) // tie A/B: A001, lower service time

    const board = await getBoard()
    expect(board.A.lastCalledTickets).toEqual([
      { code: 'A001', counterId: 2, calledAt: expect.stringMatching(/Z$/) },
    ])
    expect(board.B.lastCalledTickets).toEqual([])
    expect(board.B.queueLength).toBe(1)
  })

  it('does not change when nobody is waiting', async () => {
    const before = await getBoard()
    await callNext(1).expect(204)
    expect(await getBoard()).toEqual(before)
  })

  it('is empty again after the morning reset', async () => {
    await getTickets('A', 1)
    await callNext(1).expect(200)
    await request(app).post('/api/test/reset').expect(204)

    const board = await getBoard()
    expect(board.A).toEqual({ name: 'Payments', queueLength: 0, lastCalledTickets: [] })
  })
})

describe('GET /api/board/events', () => {
  it('opens an event stream and sends the current board first', async () => {
    await getTickets('A', 1)
    const stream = await openBoardStream()
    try {
      expect(stream.response.status).toBe(200)
      expect(stream.response.headers.get('content-type')).toMatch(/^text\/event-stream/)

      const first = await stream.nextEvent()
      expect(first.event).toBe('board-state')
      expect(first.data).toEqual(await getBoard())
    } finally {
      stream.close()
    }
  })

  it('sends the new board when a customer gets a ticket', async () => {
    const stream = await openBoardStream()
    try {
      await stream.nextEvent()
      await getTicket('B').expect(201)

      const update = await stream.nextEvent()
      expect(update.event).toBe('board-state')
      expect(update.data.B.queueLength).toBe(1)
    } finally {
      stream.close()
    }
  })

  it('sends the new board when a counter calls the next customer', async () => {
    await getTickets('C', 1)
    const stream = await openBoardStream()
    try {
      await stream.nextEvent()
      await callNext(3).expect(200)

      const update = await stream.nextEvent()
      expect(update.event).toBe('board-state')
      expect(update.data.C.queueLength).toBe(0)
      expect(update.data.C.lastCalledTickets).toEqual([
        { code: 'C001', counterId: 3, calledAt: expect.stringMatching(/Z$/) },
      ])
    } finally {
      stream.close()
    }
  })

  it('sends the same update to every open board', async () => {
    const first = await openBoardStream()
    const second = await openBoardStream()
    try {
      await first.nextEvent()
      await second.nextEvent()
      await getTicket('A').expect(201)
      await callNext(1).expect(200)

      // ticket issued, then ticket called
      await first.nextEvent()
      await second.nextEvent()
      const a = await first.nextEvent()
      const b = await second.nextEvent()
      expect(a.data).toEqual(b.data)
      expect(a.data.A.lastCalledTickets[0]).toMatchObject({ code: 'A001', counterId: 1 })
    } finally {
      first.close()
      second.close()
    }
  })
})

describe('a failing board listener', () => {
  it('does not change the answers of the routes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unsubscribe = subscribeToBoardEvents(() => { throw new Error('board stream broken') })
    try {
      const ticket = await getTicket('A').expect(201)
      expect(ticket.body.code).toBe('A001')

      const called = await callNext(1).expect(200)
      expect(called.body).toMatchObject({ code: 'A001', counterId: 1 })
      expect(console.error).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      vi.restoreAllMocks()
    }
  })
})
