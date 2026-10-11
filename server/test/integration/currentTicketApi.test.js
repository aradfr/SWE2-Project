/* Integration tests of GET /api/counters/:id/current (ticket in progress of a counter).
The real Express app, the real services and the real store are used, with
SQLite on a temporary file: the development database is never touched.
Requests go through Supertest, without app.listen. */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'
import { addTicket, reset, close } from '../../src/store.js'
import { openDatabase } from '../../src/dao/db.js'

const dbPath = path.join(os.tmpdir(), `oqm-current-ticket-${process.pid}-${Date.now()}.db`)

beforeAll(() => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
})

beforeEach(async () => {
  await reset()
})

afterAll(async () => {
  await close()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(`${dbPath}${suffix}`, { force: true })
  }
})

const callNext = (id) => request(app).post(`/api/counters/${id}/next`)
const getCurrent = (id) => request(app).get(`/api/counters/${id}/current`)

async function addTickets(serviceType, count) {
  for (let i = 0; i < count; i++) await addTicket({ serviceType })
}

// Local date (YYYY-MM-DD) of yesterday, computed like today() in the store
function yesterday() {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return { day: `${yyyy}-${mm}-${dd}`, iso: date.toISOString() }
}

// Calls the next customer at each counter in turn and returns the codes received
async function callInTurn(counterIds) {
  const codes = []
  for (const id of counterIds) {
    const res = await callNext(id)
    expect(res.status, `counter ${id}`).toBe(200)
    codes.push(res.body.code)
  }
  return codes
}

describe('GET /api/counters/:id/current', () => {
  // IC1: a counter that never called anyone has no ticket in progress.
  it('answers 204 for a counter that never called anyone', async () => {
    await addTickets('A', 1)

    const res = await getCurrent(2)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
  })

  // IC2: after a page reload the counter gets back the same ticket it called.
  it('returns the ticket just called by the counter, as after a page reload', async () => {
    await addTickets('A', 1)
    const called = await callNext(2)
    expect(called.status).toBe(200)

    const res = await getCurrent(2)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(called.body)
    expect(res.body).toMatchObject({
      id: called.body.id,
      code: 'A001',
      serviceType: 'A',
      status: 'called',
      counterId: 2,
    })
  })

  // IC3: the ticket in progress is the last one called, not the one with the highest id.
  // Tickets taken B001 (id 1), B002 (id 2), A001 (id 3), A002 (id 4). By the rule counter 2
  // calls A001 (tie, A is faster), B001 (B longer), A002 (tie), B002. B002 has id 2, while
  // the called ticket with the highest id is A002 (id 4): the test tells call order from id.
  it('returns the last ticket called, not the one with the highest id', async () => {
    await addTickets('B', 2)
    await addTickets('A', 2)

    expect(await callInTurn([2, 2, 2, 2])).toEqual(['A001', 'B001', 'A002', 'B002'])

    const res = await getCurrent(2)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 2, code: 'B002', counterId: 2 })
  })

  // IC4: each counter keeps its own ticket in progress.
  // With A x3, B x2, C x2 and calls on counters 1, 2, 3, 1, 2, 3 the rule gives
  // A001, A002 (tie, A is faster), C001, A003, B001, C002.
  it('keeps a separate ticket in progress for each counter', async () => {
    await addTickets('A', 3)
    await addTickets('B', 2)
    await addTickets('C', 2)

    expect(await callInTurn([1, 2, 3, 1, 2, 3])).toEqual(['A001', 'A002', 'C001', 'A003', 'B001', 'C002'])

    const results = []
    for (const id of [1, 2, 3]) {
      const res = await getCurrent(id)
      results.push({ status: res.status, code: res.body.code, counterId: res.body.counterId })
    }
    expect(results).toEqual([
      { status: 200, code: 'A003', counterId: 1 },
      { status: 200, code: 'B001', counterId: 2 },
      { status: 200, code: 'C002', counterId: 3 },
    ])
  })

  // IC5: a call that finds nobody (204) does not change the ticket in progress.
  it('keeps the previous ticket after a call that finds nobody', async () => {
    await addTickets('A', 1)
    expect((await callNext(1)).status).toBe(200)
    expect((await callNext(1)).status).toBe(204)

    const res = await getCurrent(1)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe('A001')
  })

  // IC6: a counter id is accepted only as a positive decimal integer.
  it('answers 400 for a counter id that is not a positive decimal integer', async () => {
    for (const id of ['0', '-1', 'abc', '0x2', '2.0', '1e1', '+2', '02']) {
      const res = await getCurrent(id)
      expect(res.status, `id ${id}`).toBe(400)
      expect(res.headers['content-type'], `id ${id}`).toMatch(/json/)
      expect(res.body.error, `id ${id}`).toEqual(expect.any(String))
    }
  })

  // IC7: an unknown counter is a 404.
  it('answers 404 for an unknown counter', async () => {
    const res = await getCurrent(99)

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.body.error).toEqual(expect.any(String))
  })

  // IC8: after a reset (tickets deleted) no ticket is in progress.
  it('answers 204 after a reset', async () => {
    await addTickets('A', 1)
    expect((await callNext(1)).status).toBe(200)

    await reset()
    const res = await getCurrent(1)

    expect(res.status).toBe(204)
  })

  // IC10: the ticket in progress from yesterday does not count today (the next morning
  // the officer must not see yesterday's customer); a call made today replaces it.
  it("ignores yesterday's ticket in progress and shows the one called today", async () => {
    const { day, iso } = yesterday()
    const db = await openDatabase(dbPath)
    try {
      const { lastID: oldId } = await db.run(
        `INSERT INTO tickets (code, service_tag, sequence_number, issued_at, status, counter_id, called_at, queue_day)
         VALUES ('A001', 'A', 1, ?, 'called', 2, ?, ?)`,
        [iso, iso, day],
      )
      await db.run('UPDATE counters SET current_ticket_id = ? WHERE id = 2', [oldId])

      // The preparation must really point counter 2 to yesterday's called ticket,
      // otherwise the 204 below could pass for the wrong reason.
      expect(await db.get(
        `SELECT t.id, t.status, t.counter_id AS counterId, t.queue_day AS queueDay
         FROM counters c JOIN tickets t ON t.id = c.current_ticket_id WHERE c.id = 2`,
      )).toEqual({ id: oldId, status: 'called', counterId: 2, queueDay: day })
    } finally {
      await db.close()
    }

    const before = await getCurrent(2)
    expect(before.status).toBe(204)
    expect(before.text).toBe('')

    await addTicket({ serviceType: 'A' })
    const called = await callNext(2)
    expect(called.status).toBe(200)

    const after = await getCurrent(2)

    expect(after.status).toBe(200)
    expect(after.body).toMatchObject({ id: called.body.id, code: called.body.code, counterId: 2 })
  })
})

describe('unexpected errors', () => {
  // IC9: a database failure is a 500 with a JSON error, not a 204 or a crash.
  // A second connection renames the tickets table, so the next query of the store fails.
  it('answers 500 when the database fails', async () => {
    await addTickets('A', 1)
    expect((await callNext(2)).status).toBe(200)
    const db = await openDatabase(dbPath)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.run('ALTER TABLE tickets RENAME TO tickets_broken')

    try {
      const res = await getCurrent(2)

      expect(res.status).toBe(500)
      expect(res.headers['content-type']).toMatch(/json/)
      expect(res.body.error).toEqual(expect.any(String))
    } finally {
      await db.run('ALTER TABLE tickets_broken RENAME TO tickets')
      await db.close()
      consoleError.mockRestore()
    }
  })
})
