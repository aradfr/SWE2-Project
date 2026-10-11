// Integration tests for the "Get ticket" story: real Express app, real
// services and real SQLite store, through HTTP (Supertest).
// The database is a throwaway file in the OS temp dir, so the development
// database (server/data/office_queue.db) is never touched.

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import request from 'supertest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import app from '../../src/app.js'
import { close, getQueue, getQueueLength } from '../../src/store.js'
import { SERVICES } from '../../src/seed.js'

// Expectations come from the seed, so changing the seed does not break these tests.
// The tests need at least three services and an unused tag.
const [first, second, third] = SERVICES.map((s) => s.tag)
const UNKNOWN_TAG = 'Z'
const code = (tag, n) => `${tag}${String(n).padStart(3, '0')}`

// The store opens the database lazily on first use, so setting the path
// before any request is enough (imports above do not open it).
const dbPath = path.join(os.tmpdir(), `oqm-get-ticket-${process.pid}-${Date.now()}.db`)

const json = (body) =>
  request(app).post('/api/tickets').set('Content-Type', 'application/json').send(body)
const takeTicket = (serviceType) => json({ serviceType })

beforeAll(() => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
  vi.stubEnv('NODE_ENV', 'test')
})

beforeEach(async () => {
  // Every test starts from empty queues and numbering (the "morning reset").
  await request(app).post('/api/test/reset').expect(204)
})

afterEach(() => {
  // Undo per-test env changes (e.g. the production-mode reset test) but keep the DB path.
  vi.stubEnv('NODE_ENV', 'test')
})

afterAll(async () => {
  await close()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(dbPath + suffix, { force: true })
  }
})

describe('GET /api/health', () => {
  it('answers 200 { status: "ok" }', async () => {
    const res = await request(app).get('/api/health').expect(200).expect('Content-Type', /json/)
    expect(res.body).toEqual({ status: 'ok' })
  })
})

describe('GET /api/services', () => {
  // The customer chooses among the configured service types.
  it('returns all seeded services with the Service schema fields', async () => {
    const res = await request(app).get('/api/services').expect(200).expect('Content-Type', /json/)
    expect(Object.keys(res.body)).toEqual(['services'])
    expect(res.body.services).toEqual(SERVICES.map((s) => ({ ...s })))
    for (const service of res.body.services) {
      expect(service).toEqual({
        tag: expect.any(String),
        name: expect.any(String),
        serviceTime: expect.any(Number),
      })
      expect(Number.isInteger(service.serviceTime)).toBe(true)
    }
  })
})

describe('POST /api/tickets', () => {
  // Main scenario of the story: the customer selects a service and gets a ticket.
  it('issues a waiting ticket with the Ticket schema', async () => {
    const res = await takeTicket(first).expect(201).expect('Content-Type', /json/)
    expect(res.body).toEqual({
      id: expect.any(Number),
      code: code(first, 1),
      serviceType: first,
      issuedAt: expect.any(String),
      status: 'waiting',
    })
    expect(Number.isInteger(res.body.id)).toBe(true)
    expect(new Date(res.body.issuedAt).toISOString()).toBe(res.body.issuedAt)
  })

  // The ticket really enters the queue of its service, which the other stories read.
  it('adds the ticket to the queue of its service only', async () => {
    const { body: ticket } = await takeTicket(second).expect(201)
    for (const { tag } of SERVICES) {
      expect(await getQueueLength(tag)).toBe(tag === second ? 1 : 0)
    }
    const [queued] = await getQueue(second)
    // The store's queue view omits status for waiting tickets: only id and code are compared.
    expect(queued).toMatchObject({ id: ticket.id, code: code(second, 1) })
  })

  // Numbering is per service; ids are global and unique.
  it('numbers tickets per service and keeps ids unique', async () => {
    const codes = []
    const ids = []
    for (const tag of [first, first, second, first, third]) {
      const { body } = await takeTicket(tag).expect(201)
      codes.push(body.code)
      ids.push(body.id)
    }
    expect(codes).toEqual([code(first, 1), code(first, 2), code(second, 1), code(first, 3), code(third, 1)])
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Several customers at the kiosk at the same moment must still get distinct codes.
  // Known to fail until the DAO transaction serialization fix (PR #8, commit 230d01c)
  // reaches this branch: without it, parallel requests share one SQLite connection and
  // nested BEGIN IMMEDIATE answers 500. Verified to pass once that commit is applied.
  it('issues distinct codes for simultaneous requests', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => takeTicket(first)))
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    const codes = responses.map((r) => r.body.code).sort()
    expect(codes).toEqual([1, 2, 3, 4, 5].map((n) => code(first, n)))
    expect(await getQueueLength(first)).toBe(5)
  })

  // Malformed requests -> 400 { error }, never 404 or 500.
  it.each([
    ['no body', () => request(app).post('/api/tickets'), 'request body must be a JSON object'],
    ['an empty object', () => json({}), 'serviceType is required'],
    ['a numeric serviceType', () => json({ serviceType: 42 }), 'serviceType must be a non-empty string'],
    ['a blank serviceType', () => json({ serviceType: '  ' }), 'serviceType must be a non-empty string'],
    ['an array body', () => json([first]), 'request body must be a JSON object'],
    ['malformed JSON', () => json('{bad'), 'invalid JSON body'],
  ])('answers 400 for %s', async (_label, send, message) => {
    const res = await send().expect(400).expect('Content-Type', /json/)
    expect(res.body).toEqual({ error: message })
  })

  // Seed guard: the tests above and below rely on these properties of the seed.
  it('has a seed the tests can rely on', () => {
    expect(SERVICES.length).toBeGreaterThanOrEqual(3)
    expect(SERVICES.map((s) => s.tag)).not.toContain(UNKNOWN_TAG)
    expect(SERVICES.map((s) => s.tag)).not.toContain(first.toLowerCase())
  })

  // Unknown service tags (tags are case-sensitive) -> 404 { error }.
  it.each([UNKNOWN_TAG, first.toLowerCase()])('answers 404 for unknown service type %s', async (tag) => {
    const res = await takeTicket(tag).expect(404).expect('Content-Type', /json/)
    expect(res.body).toEqual({ error: `Unknown service type: ${tag}` })
  })

  // A rejected request must not consume a number nor add anything to a queue.
  it('does not consume a number on rejected requests', async () => {
    await json({}).expect(400)
    await takeTicket(UNKNOWN_TAG).expect(404)
    await json('{bad').expect(400)
    const { body } = await takeTicket(first).expect(201)
    expect(body.code).toBe(code(first, 1))
    expect(await getQueueLength(first)).toBe(1)
  })
})

describe('unknown /api routes', () => {
  // Wrong path or wrong method -> JSON 404 (components/responses/NotFound).
  it.each([
    ['get', '/api/nope'],
    ['get', '/api/tickets'],
    ['delete', '/api/tickets'],
    ['put', '/api/services'],
  ])('%s %s answers JSON 404', async (method, url) => {
    const res = await request(app)[method](url).expect(404).expect('Content-Type', /json/)
    expect(res.body).toEqual({ error: `Not found: ${method.toUpperCase()} ${url}` })
  })
})

describe('POST /api/test/reset', () => {
  // Morning reset: queues are emptied and numbering restarts.
  it('answers 204 and restarts numbering and ids', async () => {
    await takeTicket(first).expect(201)
    await takeTicket(second).expect(201)
    const res = await request(app).post('/api/test/reset').expect(204)
    expect(res.text).toBe('')
    expect(await getQueueLength(first)).toBe(0)
    const { body } = await takeTicket(first).expect(201)
    expect(body).toMatchObject({ id: 1, code: code(first, 1) })
  })

  // Outside test mode the reset is refused and data is kept.
  it('answers 403 and keeps the data when NODE_ENV is not test', async () => {
    await takeTicket(first).expect(201)
    vi.stubEnv('NODE_ENV', 'production')
    const res = await request(app).post('/api/test/reset').expect(403).expect('Content-Type', /json/)
    expect(res.body).toEqual({ error: 'reset is only available in test mode' })
    vi.stubEnv('NODE_ENV', 'test')
    const { body } = await takeTicket(first).expect(201)
    expect(body.code).toBe(code(first, 2))
  })
})

describe('test database isolation', () => {
  // Guard: these tests must never write to the development database.
  it('uses the temporary database file', async () => {
    expect(process.env.SQLITE_DB_PATH).toBe(dbPath)
    await expect(fs.stat(dbPath)).resolves.toBeTruthy()
  })
})
