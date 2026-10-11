// @vitest-environment node
// Integration tests for the "Call customer" story, client side: the real
// getBoard() of api/client.js talks over HTTP to the real Express app with the
// real SQLite store. Tickets are issued and called through the real API, then
// the board read by the client must show them. Only the base URL is changed:
// fetch prefixes the relative /api URLs with the address of a test server.
// The database is a throwaway temp file; the dev database is never touched.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getBoard, ApiError } from '../../src/api/client.js'
import { SERVICES } from '../../../server/src/seed.js'

const dbPath = path.join(os.tmpdir(), `oqm-client-board-${Date.now()}-${Math.random()}.db`)

let server
let baseUrl
let closeStore
const realFetch = globalThis.fetch

beforeAll(async () => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
  vi.stubEnv('NODE_ENV', 'test')
  const { default: app } = await import('../../../server/src/app.js')
  ;({ close: closeStore } = await import('../../../server/src/store.js'))
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  vi.stubGlobal('fetch', (url, init) => realFetch(baseUrl + url, init))
})

beforeEach(async () => {
  const res = await realFetch(`${baseUrl}/api/test/reset`, { method: 'POST' })
  expect(res.status).toBe(204)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await closeStore()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(dbPath + suffix, { force: true })
  }
})

async function issue(serviceType, count = 1) {
  for (let i = 0; i < count; i++) {
    const res = await realFetch(`${baseUrl}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceType }),
    })
    expect(res.status).toBe(201)
  }
}

async function callNext(counterId) {
  const res = await realFetch(`${baseUrl}/api/counters/${counterId}/next`, { method: 'POST' })
  return res.status === 204 ? null : res.json()
}

describe('getBoard (client -> server)', () => {
  it('shows every service of the seed with empty queues after the reset', async () => {
    const board = await getBoard()
    expect(Object.keys(board)).toEqual(SERVICES.map((s) => s.tag))
    for (const service of SERVICES) {
      expect(board[service.tag]).toEqual({ name: service.name, queueLength: 0, lastCalledTickets: [] })
    }
  })

  it('counts the tickets issued for each service', async () => {
    await issue('A', 2)
    await issue('C', 1)
    const board = await getBoard()
    expect(board.A.queueLength).toBe(2)
    expect(board.B.queueLength).toBe(0)
    expect(board.C.queueLength).toBe(1)
  })

  it('shows the ticket a counter has called, with an ISO call time', async () => {
    await issue('A', 2)
    const called = await callNext(1)
    const board = await getBoard()

    expect(board.A.queueLength).toBe(1)
    expect(board.A.lastCalledTickets).toEqual([
      { code: called.code, counterId: 1, calledAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) },
    ])
  })

  it('shows only the last call of a counter that serves two services', async () => {
    await issue('A', 1)
    await issue('B', 2)
    await callNext(2) // B001, B is longer
    await callNext(2) // A001, tie: A is faster

    const board = await getBoard()
    expect(board.A.lastCalledTickets.map((t) => [t.code, t.counterId])).toEqual([['A001', 2]])
    expect(board.B.lastCalledTickets).toEqual([])
  })

  it('does not change when a counter has nobody to call', async () => {
    const before = await getBoard()
    expect(await callNext(3)).toBeNull()
    expect(await getBoard()).toEqual(before)
  })
})

describe('getBoard errors', () => {
  it('throws ApiError with the server message on an error answer', async () => {
    // /api/boards does not exist: the server answers 404 with the Error body
    vi.stubGlobal('fetch', (url, init) => realFetch(baseUrl + url.replace('/api/board', '/api/boards'), init))
    try {
      const error = await getBoard().catch((e) => e)
      expect(error).toBeInstanceOf(ApiError)
      expect(error.status).toBe(404)
    } finally {
      vi.stubGlobal('fetch', (url, init) => realFetch(baseUrl + url, init))
    }
  })
})
