// @vitest-environment node
// Integration tests for the "Get ticket" story, client side: the real
// api/customer.js and api/client.js talk over HTTP to the real Express app
// with the real SQLite store. Nothing is mocked except the base URL: the
// browser sends relative /api URLs that Vite proxies to the server, so here
// fetch prefixes them with the address of a server started on a free port.
// The database is a throwaway temp file; the dev database is never touched.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { getServices, createTicket } from '../../src/api/customer.js'
import { ApiError } from '../../src/api/client.js'
import { SERVICES } from '../../../server/src/seed.js'

// Expectations come from the server seed, so changing the seed does not break these tests.
// The tests need at least two services (per-service numbering) and an unused tag.
const [first, second] = SERVICES.map((s) => s.tag)
const UNKNOWN_TAG = 'Z'

const dbPath = path.join(os.tmpdir(), `oqm-client-get-ticket-${Date.now()}-${Math.random()}.db`)

let server
let baseUrl
let closeStore
const realFetch = globalThis.fetch

beforeAll(async () => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
  vi.stubEnv('NODE_ENV', 'test')
  // Imported after the env is set; the store opens the database lazily anyway.
  const { default: app } = await import('../../../server/src/app.js')
  ;({ close: closeStore } = await import('../../../server/src/store.js'))
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
  // Same role as the Vite dev proxy: relative /api/... -> the test server.
  vi.stubGlobal('fetch', (url, init) => realFetch(baseUrl + url, init))
})

beforeEach(async () => {
  // Start every test from empty queues (the "morning reset").
  const res = await realFetch(`${baseUrl}/api/test/reset`, { method: 'POST' })
  expect(res.status).toBe(204)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise((resolve) => server.close(resolve))
  await closeStore()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(dbPath + suffix, { force: true })
  }
})

describe('getServices (client -> server)', () => {
  // The kiosk shows the services configured on the server.
  it('returns the services configured on the server', async () => {
    const services = await getServices()
    expect(services).toEqual(SERVICES.map((s) => ({ ...s })))
  })
})

describe('createTicket (client -> server)', () => {
  // Guard for the seed-based expectations below.
  it('has a seed the tests can rely on', () => {
    expect(SERVICES.length).toBeGreaterThanOrEqual(2)
    expect(SERVICES.map((s) => s.tag)).not.toContain(UNKNOWN_TAG)
  })

  // Main scenario: the customer selects a service and receives a ticket.
  it('returns a waiting ticket from the server', async () => {
    const ticket = await createTicket(first)
    expect(ticket).toEqual({
      id: expect.any(Number),
      code: `${first}001`,
      serviceType: first,
      issuedAt: expect.any(String),
      status: 'waiting',
    })
  })

  // Codes come from the server's per-service numbering.
  it('gets per-service codes for consecutive tickets', async () => {
    const codes = []
    for (const tag of [first, second, first]) codes.push((await createTicket(tag)).code)
    expect(codes).toEqual([`${first}001`, `${second}001`, `${first}002`])
  })

  // Every service listed by the server can be selected.
  it('can take a ticket for every listed service', async () => {
    for (const { tag } of await getServices()) {
      const ticket = await createTicket(tag)
      expect(ticket).toMatchObject({ serviceType: tag, code: `${tag}001` })
    }
  })

  // Unknown service: the page receives ApiError 404 with the server message.
  it('rejects an unknown service with ApiError 404', async () => {
    const error = await createTicket(UNKNOWN_TAG).catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.message).toBe(`Unknown service type: ${UNKNOWN_TAG}`)
  })

  // Invalid request: ApiError 400 with the server's validation message.
  it('rejects an invalid service type with ApiError 400', async () => {
    const error = await createTicket('   ').catch((err) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(400)
    expect(error.message).toBe('serviceType must be a non-empty string')
  })

  // A rejected attempt does not use up a number.
  it('does not consume a number on a rejected request', async () => {
    await createTicket(UNKNOWN_TAG).catch(() => {})
    expect((await createTicket(first)).code).toBe(`${first}001`)
  })
})

describe('server unreachable', () => {
  // With no server listening, the page gets a readable error instead of a crash.
  it('reports that the server cannot be reached', async () => {
    vi.stubGlobal('fetch', (url, init) => realFetch(`http://127.0.0.1:1${url}`, init))
    try {
      const error = await getServices().catch((err) => err)
      expect(error).not.toBeInstanceOf(ApiError)
      expect(error.message).toBe('Cannot reach the server. Is it running?')
    } finally {
      vi.stubGlobal('fetch', (url, init) => realFetch(baseUrl + url, init))
    }
  })
})
