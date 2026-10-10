/* Integration tests of the Next customer API.
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

const dbPath = path.join(os.tmpdir(), `oqm-next-customer-${process.pid}-${Date.now()}.db`)

// Services of each counter, from the seed of the specification
const COUNTER_SERVICES = { 1: ['A'], 2: ['A', 'B'], 3: ['C'] }
const ROUNDS = 10

let db // second connection, used to inspect the database

beforeAll(async () => {
  vi.stubEnv('SQLITE_DB_PATH', dbPath)
  db = await openDatabase(dbPath)
})

beforeEach(async () => {
  await reset()
})

afterAll(async () => {
  await close()
  await db.close()
  vi.unstubAllEnvs()
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await fs.rm(`${dbPath}${suffix}`, { force: true })
  }
})

const callNext = (id) => request(app).post(`/api/counters/${id}/next`)

async function addTickets(serviceType, count) {
  const tickets = []
  for (let i = 0; i < count; i++) tickets.push(await addTicket({ serviceType }))
  return tickets
}

const readTickets = () =>
  db.all('SELECT id, code, service_tag, status, counter_id, called_at FROM tickets ORDER BY id')

async function queueLength(tag) {
  const row = await db.get(
    "SELECT COUNT(*) AS length FROM tickets WHERE service_tag = ? AND status = 'waiting'",
    [tag],
  )
  return row.length
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

async function addYesterdayTicket() {
  const { day, iso } = yesterday()
  const result = await db.run(
    `INSERT INTO tickets (code, service_tag, sequence_number, issued_at, status, queue_day)
     VALUES ('A001', 'A', 1, ?, 'waiting', ?)`,
    [iso, day],
  )
  return result.lastID
}

// Short form of a response: the ticket code, or the status for any other answer
const outcome = (res) => (res.status === 200 ? res.body.code : String(res.status))

// Status, code and error of each call, for the failure messages
const describeCalls = (calls) =>
  JSON.stringify(calls.map(({ counterId, res }) => ({
    counterId,
    status: res.status,
    ...(res.body?.code ? { code: res.body.code } : {}),
    ...(res.body?.error ? { error: res.body.error } : {}),
  })))

// Invariants of every concurrent round: no ticket given twice, the called
// tickets in the database are exactly the returned ones (with the right
// counter) and no counter gets a service it does not handle
async function checkInvariants(round, calls) {
  const message = `round ${round}: ${describeCalls(calls)}`
  const returned = calls.filter(({ res }) => res.status === 200)

  const ids = returned.map(({ res }) => res.body.id)
  expect(new Set(ids).size, message).toBe(ids.length)

  for (const { counterId, res } of returned) {
    expect(COUNTER_SERVICES[counterId], message).toContain(res.body.serviceType)
  }

  const called = (await readTickets())
    .filter((ticket) => ticket.status === 'called')
    .map((ticket) => ({ id: ticket.id, counterId: ticket.counter_id }))
    .sort((a, b) => a.id - b.id)
  const expected = returned
    .map(({ counterId, res }) => ({ id: res.body.id, counterId }))
    .sort((a, b) => a.id - b.id)
  expect(called, message).toEqual(expected)
}

describe('POST /api/counters/:id/next', () => {
  it('calls the first ticket of the longest queue of the counter', async () => {
    await addTickets('A', 1)
    await addTickets('B', 3)

    const res = await callNext('2')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: expect.any(Number),
      code: 'B001',
      serviceType: 'B',
      issuedAt: expect.any(String),
      status: 'called',
      counterId: 2,
    })
  })

  it('marks the called ticket in the database and shortens only that queue', async () => {
    await addTickets('A', 1)
    await addTickets('B', 3)

    const res = await callNext(2)
    expect(res.status).toBe(200)

    const tickets = await readTickets()
    const called = tickets.find((ticket) => ticket.code === 'B001')
    expect(called.status).toBe('called')
    expect(called.counter_id).toBe(2)
    expect(called.called_at).not.toBeNull()
    for (const ticket of tickets.filter((ticket) => ticket.code !== 'B001')) {
      expect(ticket.status).toBe('waiting')
      expect(ticket.counter_id).toBeNull()
    }
    expect(await queueLength('B')).toBe(2)
    expect(await queueLength('A')).toBe(1)
  })

  it('serves a queue in FIFO order', async () => {
    await addTickets('A', 2)

    const first = await callNext(1)
    const second = await callNext(1)

    expect(first.status).toBe(200)
    expect(first.body.code).toBe('A001')
    expect(second.status).toBe(200)
    expect(second.body.code).toBe('A002')
  })

  it('on equal length serves the queue with the lower service time', async () => {
    await addTickets('A', 2)
    await addTickets('B', 2)

    const res = await callNext(2)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe('A001')
  })

  it('follows the rule across consecutive calls until the queues are empty', async () => {
    await addTickets('A', 1)
    await addTickets('B', 2)

    const results = []
    for (let i = 0; i < 4; i++) results.push(outcome(await callNext(2)))

    expect(results).toEqual(['B001', 'A001', 'B002', '204'])
  })

  it('ignores queues of services the counter does not handle', async () => {
    await addTickets('A', 1)
    await addTickets('C', 5)

    const res = await callNext(1)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe('A001')
  })

  it('answers 204 and changes nothing when the counter queues are empty', async () => {
    await addTickets('C', 2)

    const res = await callNext(2)

    expect(res.status).toBe(204)
    expect(res.text).toBe('')
    for (const ticket of await readTickets()) expect(ticket.status).toBe('waiting')
  })

  it('answers 404 for an unknown counter', async () => {
    const res = await callNext(99)

    expect(res.status).toBe(404)
    expect(res.body.error).toEqual(expect.any(String))
  })

  it('answers 400 for a counter id that is not a positive integer', async () => {
    await addTickets('A', 1)
    await addTickets('B', 1)

    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await callNext(id)
      expect(res.status, `id ${id}`).toBe(400)
      expect(res.body.error, `id ${id}`).toEqual(expect.any(String))
    }
    for (const ticket of await readTickets()) expect(ticket.status).toBe('waiting')
  })

  it('does not call the same ticket twice', async () => {
    await addTickets('A', 1)

    const first = await callNext(1)
    const second = await callNext(1)

    expect(first.status).toBe(200)
    expect(first.body.code).toBe('A001')
    expect(second.status).toBe(204)
  })

  it('answers 400 for ids written in a non-decimal or non-integer form', async () => {
    await addTickets('A', 1)
    await addTickets('B', 1)

    for (const id of ['0x2', '2.0', '1e1', '+2', '02']) {
      const res = await callNext(id)
      expect(res.status, `id ${id}`).toBe(400)
      expect(res.body.error, `id ${id}`).toEqual(expect.any(String))
    }
    for (const ticket of await readTickets()) expect(ticket.status).toBe('waiting')
  })

  it('ignores tickets left waiting from a previous day', async () => {
    const oldId = await addYesterdayTicket()

    const res = await callNext(1)

    expect(res.status).toBe(204)
    const old = (await readTickets()).find((ticket) => ticket.id === oldId)
    expect(old.status).toBe('waiting')
  })

  it("serves today's ticket and not the one left from a previous day", async () => {
    const oldId = await addYesterdayTicket()
    const [todayTicket] = await addTickets('A', 1)

    const res = await callNext(1)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(todayTicket.id)
    const old = (await readTickets()).find((ticket) => ticket.id === oldId)
    expect(old.status).toBe('waiting')
  })

  it('serves the only service of a single-service counter (counter 3)', async () => {
    await addTickets('A', 4)
    await addTickets('C', 1)

    const res = await callNext(3)

    expect(res.status).toBe(200)
    expect(res.body.code).toBe('C001')
  })
})

describe('concurrent calls', () => {
  // Runs a scenario ROUNDS times; each round starts from an empty database
  async function repeat(prepare, run, check) {
    for (let round = 1; round <= ROUNDS; round++) {
      await reset()
      await prepare()
      const calls = await run()
      check(round, calls)
      await checkInvariants(round, calls)
    }
  }

  // Two calls at the same time; returns [{ counterId, res }] in request order
  async function together(...counterIds) {
    const responses = await Promise.all(counterIds.map((id) => callNext(id)))
    return responses.map((res, i) => ({ counterId: counterIds[i], res }))
  }

  it('two simultaneous calls to the same queue get different tickets', async () => {
    await repeat(
      () => addTickets('A', 2),
      () => together(1, 1),
      (round, calls) => {
        const got = calls.map(({ res }) => outcome(res)).sort()
        expect(got, `round ${round}: ${describeCalls(calls)}`).toEqual(['A001', 'A002'])
      },
    )
  })

  it('a queue emptied by another counter is not lost for the other services', async () => {
    await repeat(
      async () => {
        await addTickets('A', 1)
        await addTickets('B', 1)
      },
      () => together(1, 2),
      (round, calls) => {
        const got = calls.map(({ res }) => outcome(res))
        expect([['A001', 'B001'], ['204', 'A001']], `round ${round}: ${describeCalls(calls)}`)
          .toContainEqual(got)
      },
    )
  })

  it('simultaneous calls choose on up-to-date queue lengths', async () => {
    await repeat(
      async () => {
        await addTickets('A', 5)
        await addTickets('B', 5)
      },
      () => together(1, 2),
      (round, calls) => {
        const got = calls.map(({ res }) => outcome(res))
        expect([['A001', 'B001'], ['A002', 'A001']], `round ${round}: ${describeCalls(calls)}`)
          .toContainEqual(got)
      },
    )
  })

  it('a single waiting ticket is given to only one of two simultaneous calls', async () => {
    await repeat(
      () => addTickets('A', 1),
      () => together(1, 1),
      (round, calls) => {
        const got = calls.map(({ res }) => outcome(res)).sort()
        expect(got, `round ${round}: ${describeCalls(calls)}`).toEqual(['204', 'A001'])
      },
    )
  })

  it('issuing a ticket and calling the next customer at the same time both succeed', async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      await reset()
      await addTickets('A', 1)

      const [created, settled] = await Promise.allSettled([
        addTicket({ serviceType: 'A' }),
        callNext(1),
      ])
      const message = `round ${round}: ${JSON.stringify({
        created: created.status === 'fulfilled' ? created.value : String(created.reason),
        call: settled.status === 'fulfilled'
          ? { status: settled.value.status, body: settled.value.body }
          : String(settled.reason),
      })}`

      expect(created.status, message).toBe('fulfilled')
      expect(settled.status, message).toBe('fulfilled')
      const res = settled.value
      expect(res.status, message).toBe(200)
      expect(res.body.code, message).toBe('A001')

      const stored = (await readTickets()).find((ticket) => ticket.id === created.value.id)
      expect(stored?.status, message).toBe('waiting')

      await checkInvariants(round, [{ counterId: 1, res }])
    }
  })

  it('many simultaneous calls keep the database consistent', async () => {
    await repeat(
      async () => {
        await addTickets('A', 3)
        await addTickets('B', 3)
      },
      () => together(1, 1, 1, 2, 2, 2),
      (round, calls) => {
        const message = `round ${round}: ${describeCalls(calls)}`
        for (const { res } of calls) expect([200, 204], message).toContain(res.status)
        const codes = calls.filter(({ res }) => res.status === 200).map(({ res }) => res.body.code)
        expect(new Set(codes).size, message).toBe(codes.length)
        for (const { counterId, res } of calls) {
          if (counterId === 1 && res.status === 200) expect(res.body.serviceType, message).toBe('A')
        }
      },
    )
  })
})

describe('GET /api/counters', () => {
  const EXPECTED = [
    { id: 1, services: ['A'] },
    { id: 2, services: ['A', 'B'] },
    { id: 3, services: ['C'] },
  ]

  // Services are compared without depending on their order
  const normalize = (counters) =>
    counters.map(({ id, services }) => ({ id, services: [...services].sort() }))

  it('lists every counter with the services it can serve', async () => {
    const res = await request(app).get('/api/counters')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.counters)).toBe(true)
    expect(normalize(res.body.counters)).toEqual(EXPECTED)
  })

  it('does not change when tickets are waiting or called', async () => {
    await addTickets('A', 2)
    await addTickets('B', 1)
    expect((await callNext(2)).status).toBe(200)

    const res = await request(app).get('/api/counters')

    expect(res.status).toBe(200)
    expect(normalize(res.body.counters)).toEqual(EXPECTED)
  })
})

describe('unexpected errors', () => {
  it('answers 500 when the database fails', async () => {
    await addTickets('A', 1)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.run('ALTER TABLE tickets RENAME TO tickets_broken')

    try {
      const res = await callNext(1)

      expect(res.status).toBe(500)
      expect(res.headers['content-type']).toMatch(/json/)
      expect(res.body.error).toEqual(expect.any(String))
    } finally {
      await db.run('ALTER TABLE tickets_broken RENAME TO tickets')
      consoleError.mockRestore()
    }
  })
})
