import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../src/dao/db.js'
import * as officeDao from '../../src/dao/officeDao.js'
import * as ticketDao from '../../src/dao/ticketDao.js'

const databasePaths = []

// Remove temporary database files after each isolated persistence test.
afterEach(async () => {
  for (const databasePath of databasePaths.splice(0)) {
    await fs.rm(databasePath, { force: true })
    await fs.rm(`${databasePath}-shm`, { force: true })
    await fs.rm(`${databasePath}-wal`, { force: true })
  }
})

describe('database', () => {
  // A closed connection must not lose rows written by the previous connection.
  it('applies the schema and persists rows across connections', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)

    const first = await openDatabase(databasePath)
    await first.run("INSERT INTO services (tag, name, service_time) VALUES ('X', 'Test', 1)")
    await first.close()

    const second = await openDatabase(databasePath)
    expect(await second.get("SELECT name FROM services WHERE tag = 'X'")).toEqual({ name: 'Test' })
    await second.close()
  })

  it('executes custom SQL and rejects invalid SQL', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-exec-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.exec('CREATE TABLE exec_test (value TEXT)')
      await expect(db.exec('THIS IS NOT SQL')).rejects.toBeInstanceOf(Error)
      expect(await db.get("SELECT name FROM sqlite_master WHERE name = 'exec_test'")).toEqual({ name: 'exec_test' })
    } finally {
      await db.close()
    }
  })

  it('rejects a database path that cannot be opened', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-directory-${Date.now()}-${Math.random()}.db`)
    await fs.mkdir(databasePath, { recursive: true })

    await expect(openDatabase(databasePath)).rejects.toBeInstanceOf(Error)
    await fs.rm(databasePath, { recursive: true, force: true })
  })

  it('rejects closing the same connection twice', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-close-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    await db.close()
    await expect(db.close()).rejects.toBeInstanceOf(Error)
  })

  it('serializes concurrent ticket creation and dequeue operations', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-concurrency-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const first = await openDatabase(databasePath)
    const second = await openDatabase(databasePath)

    try {
      await first.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Test', 1)")
      await first.run('INSERT INTO counters (id) VALUES (1), (2)')
      const issued = await Promise.all([
        ticketDao.addTicket(first, 'A', '2026-10-08'),
        ticketDao.addTicket(second, 'A', '2026-10-08'),
      ])

      expect(new Set(issued.map((ticket) => ticket.id)).size).toBe(2)
      expect(new Set(issued.map((ticket) => ticket.code)).size).toBe(2)

      const called = await Promise.all([
        ticketDao.dequeue(first, 'A', '2026-10-08', 1),
        ticketDao.dequeue(second, 'A', '2026-10-08', 2),
      ])
      expect(called.filter(Boolean)).toHaveLength(2)
      expect(new Set(called.map((ticket) => ticket.id)).size).toBe(2)
    } finally {
      await first.close()
      await second.close()
    }
  })

  it('serializes concurrent transactions on the same connection', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-same-connection-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Test', 1)")
      await db.run('INSERT INTO counters (id) VALUES (1), (2)')
      const issued = await Promise.all([
        ticketDao.addTicket(db, 'A', '2026-10-08'),
        ticketDao.addTicket(db, 'A', '2026-10-08'),
        ticketDao.addTicket(db, 'A', '2026-10-08'),
      ])
      expect(issued.map((ticket) => ticket.code).sort()).toEqual(['A001', 'A002', 'A003'])

      const called = await Promise.all([
        ticketDao.dequeue(db, 'A', '2026-10-08', 1),
        ticketDao.dequeue(db, 'A', '2026-10-08', 2),
      ])
      expect(called.filter(Boolean)).toHaveLength(2)
      expect(new Set(called.map((ticket) => ticket.id)).size).toBe(2)
    } finally {
      await db.close()
    }
  })

  it('keeps working after a failed transaction on the same connection', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-after-failure-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Test', 1)")
      const results = await Promise.allSettled([
        ticketDao.addTicket(db, 'MISSING', '2026-10-08'),
        ticketDao.addTicket(db, 'A', '2026-10-08'),
      ])
      expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled'])
      expect(results[1].value.code).toBe('A001')
    } finally {
      await db.close()
    }
  })

  it('restarts the ticket number from 001 after 999', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-wrap-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Test', 1)")
      await db.run(
        "INSERT INTO tickets (code, service_tag, sequence_number, status, queue_day) VALUES ('A998', 'A', 998, 'waiting', '2026-10-08')",
      )
      const codes = []
      for (let i = 0; i < 3; i++) codes.push((await ticketDao.addTicket(db, 'A', '2026-10-08')).code)
      expect(codes).toEqual(['A999', 'A001', 'A002'])
    } finally {
      await db.close()
    }
  })

  it('omits issuedAt when the caller explicitly supplies null', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-null-date-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Test', 1)")
      const ticket = await ticketDao.addTicket(db, 'A', '2026-10-08', null)
      expect(ticket).not.toHaveProperty('issuedAt')
    } finally {
      await db.close()
    }
  })

  it('returns counters without services when the LEFT JOIN has no match', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-empty-counter-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await db.run('INSERT INTO counters (id) VALUES (99)')
      expect(await officeDao.getCounters(db)).toContainEqual({ id: 99, services: [] })
      expect(await officeDao.getCounter(db, 99)).toEqual({ id: 99, services: [] })
      expect(await officeDao.getCounter(db, '99')).toBeUndefined()
      expect(await officeDao.getCounter(db, 100)).toBeUndefined()
    } finally {
      await db.close()
    }
  })

  it('rolls back seed data when a service assignment violates a foreign key', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-seed-rollback-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await expect(officeDao.seedOffice(db, [{ tag: 'X', name: 'Test', serviceTime: 1 }], [
        { id: 1, services: ['MISSING'] },
      ])).rejects.toBeInstanceOf(Error)
      expect(await db.get("SELECT * FROM services WHERE tag = 'X'")).toBeUndefined()
      expect(await db.get('SELECT * FROM counters WHERE id = 1')).toBeUndefined()
    } finally {
      await db.close()
    }
  })

  it('rolls back an invalid ticket insert', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-ticket-rollback-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)

    try {
      await expect(ticketDao.addTicket(db, 'MISSING', '2026-10-09')).rejects.toBeInstanceOf(Error)
      expect(await db.get('SELECT COUNT(*) AS count FROM tickets')).toEqual({ count: 0 })
    } finally {
      await db.close()
    }
  })

  it('rolls back dequeue when selecting the next ticket fails', async () => {
    const statements = []
    const failure = new Error('select failed')
    const fakeDb = {
      run: async (sql) => {
        statements.push(sql)
      },
      get: async () => {
        throw failure
      },
    }

    await expect(ticketDao.dequeue(fakeDb, 'A', '2026-10-09')).rejects.toBe(failure)
    expect(statements).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK'])
  })
})

describe('ticketDao.callNext', () => {
  const day = '2026-10-08'
  const yesterday = '2026-10-07'

  // Temporary database with services A (3 min), B (5 min), C (10 min) and counters 1 and 2.
  async function openOffice(name) {
    const databasePath = path.join(os.tmpdir(), `office-queue-callnext-${name}-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)
    await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Payments', 3), ('B', 'Banking', 5), ('C', 'Shipping', 10)")
    await db.run('INSERT INTO counters (id) VALUES (1), (2)')
    return db
  }

  async function addTickets(db, tag, count, ticketDay = day) {
    for (let i = 0; i < count; i++) await ticketDao.addTicket(db, tag, ticketDay)
  }

  const statuses = async (db) => db.all('SELECT code, status FROM tickets ORDER BY id')

  // The first waiting ticket of the chosen queue is called for the given counter; the others keep waiting.
  it('calls the first waiting ticket of the chosen queue', async () => {
    const db = await openOffice('first')
    try {
      await addTickets(db, 'A', 2)
      await addTickets(db, 'B', 1)

      const ticket = await ticketDao.callNext(db, day, 2, () => 'A')

      expect(ticket).toMatchObject({ code: 'A001', status: 'called' })
      const called = await db.get("SELECT status, counter_id AS counterId, called_at AS calledAt FROM tickets WHERE code = 'A001'")
      expect(called.status).toBe('called')
      expect(called.counterId).toBe(2)
      expect(called.calledAt).not.toBeNull()
      expect(await db.all("SELECT code, status FROM tickets WHERE code != 'A001' ORDER BY id")).toEqual([
        { code: 'A002', status: 'waiting' },
        { code: 'B001', status: 'waiting' },
      ])
    } finally {
      await db.close()
    }
  })

  // The choice must be based only on tickets still waiting today, not on called or old tickets.
  it("passes choose the lengths of today's waiting queues only", async () => {
    const db = await openOffice('lengths')
    try {
      await addTickets(db, 'A', 3)
      await addTickets(db, 'B', 1)
      await db.run("UPDATE tickets SET status = 'called', counter_id = 1 WHERE code = 'A001' AND queue_day = ?", [day])
      await addTickets(db, 'C', 1, yesterday)
      const received = []

      await ticketDao.callNext(db, day, 1, (lengths) => {
        received.push(lengths)
        return null
      })

      expect(received).toEqual([{ A: 2, B: 1 }])
    } finally {
      await db.close()
    }
  })

  // When nobody can be served the call has no effect on the queues.
  it('returns null and changes nothing when choose returns null', async () => {
    const db = await openOffice('null')
    try {
      await addTickets(db, 'A', 1)

      expect(await ticketDao.callNext(db, day, 1, () => null)).toBeNull()
      expect(await statuses(db)).toEqual([{ code: 'A001', status: 'waiting' }])
    } finally {
      await db.close()
    }
  })

  // An error in the choice must undo the transaction and leave the connection usable.
  it('rolls back and rethrows when choose throws', async () => {
    const db = await openOffice('rollback')
    try {
      await addTickets(db, 'A', 1)
      const failure = new Error('boom')

      await expect(ticketDao.callNext(db, day, 1, () => {
        throw failure
      })).rejects.toBe(failure)
      expect(await statuses(db)).toEqual([{ code: 'A001', status: 'waiting' }])

      expect(await ticketDao.callNext(db, day, 1, () => 'A')).toMatchObject({ code: 'A001', status: 'called' })
    } finally {
      await db.close()
    }
  })

  // Two simultaneous calls must give the same result as running them one after the other.
  it('serves simultaneous calls one after the other on fresh lengths', async () => {
    const db = await openOffice('simultaneous')
    // Counter 1 handles only A; counter 2 applies the full rule (longest queue, A on a tie).
    const onlyA = (lengths) => (lengths.A ? 'A' : null)
    const fullRule = (lengths) => {
      const a = lengths.A ?? 0
      const b = lengths.B ?? 0
      if (a === 0 && b === 0) return null
      return b > a ? 'B' : 'A'
    }
    try {
      for (let run = 1; run <= 10; run++) {
        await db.run('DELETE FROM tickets')
        await addTickets(db, 'A', 5)
        await addTickets(db, 'B', 5)

        const [first, second] = await Promise.all([
          ticketDao.callNext(db, day, 1, onlyA),
          ticketDao.callNext(db, day, 2, fullRule),
        ])

        const outcome = `${first?.code} / ${second?.code}`
        expect(['A001 / B001', 'A002 / A001'], `run ${run}: ${outcome}`).toContain(outcome)
      }
    } finally {
      await db.close()
    }
  })

  // Issuing a ticket while a counter calls the next one must not make either operation fail.
  it('does not fail when a ticket is issued at the same time', async () => {
    const db = await openOffice('issue')
    try {
      await addTickets(db, 'A', 1)

      const [issued, called] = await Promise.all([
        ticketDao.addTicket(db, 'A', day),
        ticketDao.callNext(db, day, 1, () => 'A'),
      ])

      expect(called).toMatchObject({ code: 'A001', status: 'called' })
      expect(issued.code).toBe('A002')
      expect(await statuses(db)).toEqual([
        { code: 'A001', status: 'called' },
        { code: 'A002', status: 'waiting' },
      ])
    } finally {
      await db.close()
    }
  })

  // Choosing an empty queue calls nobody and leaves the other queues untouched.
  it('returns null when choose picks a queue with no waiting tickets', async () => {
    const db = await openOffice('empty-choice')
    try {
      await addTickets(db, 'A', 1)

      expect(await ticketDao.callNext(db, day, 1, () => 'B')).toBeNull()
      expect(await statuses(db)).toEqual([{ code: 'A001', status: 'waiting' }])
    } finally {
      await db.close()
    }
  })
})
