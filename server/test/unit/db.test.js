import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { openDatabase, migrate } from '../../src/dao/db.js'
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

describe('ticketDao.getCurrentTicket', () => {
  const day = '2026-10-08'
  const yesterday = '2026-10-07'

  // Temporary database with services A (3 min), B (5 min), C (10 min) and counters 1 and 2.
  async function openOffice(name) {
    const databasePath = path.join(os.tmpdir(), `office-queue-current-${name}-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const db = await openDatabase(databasePath)
    await db.run("INSERT INTO services (tag, name, service_time) VALUES ('A', 'Payments', 3), ('B', 'Banking', 5), ('C', 'Shipping', 10)")
    await db.run('INSERT INTO counters (id) VALUES (1), (2)')
    return db
  }

  async function addTickets(db, tag, count, ticketDay = day) {
    for (let i = 0; i < count; i++) await ticketDao.addTicket(db, tag, ticketDay)
  }

  const currentTicketId = async (db, counterId) =>
    (await db.get('SELECT current_ticket_id AS id FROM counters WHERE id = ?', [counterId])).id

  // CT1: a counter that never called anyone has no ticket in progress.
  it('returns null for a counter that never called anyone', async () => {
    const db = await openOffice('never')
    try {
      await addTickets(db, 'A', 1)

      expect(await ticketDao.getCurrentTicket(db, day, 1)).toBeNull()
    } finally {
      await db.close()
    }
  })

  // CT2: after a call, the called ticket is in progress, with the same shape returned by callNext.
  it('returns the ticket the counter has just called', async () => {
    const db = await openOffice('called')
    try {
      await addTickets(db, 'A', 2)
      const called = await ticketDao.callNext(db, day, 2, () => 'A')

      const current = await ticketDao.getCurrentTicket(db, day, 2)

      expect(current).toMatchObject({ code: 'A001', status: 'called' })
      expect(current).toEqual(called)
    } finally {
      await db.close()
    }
  })

  // CT3: the order of the calls decides, not the ticket ids: A001, A002, B001, A003 -> A003.
  it('returns the last ticket called, not the one with the highest id', async () => {
    const db = await openOffice('order')
    try {
      await addTickets(db, 'A', 3)
      await addTickets(db, 'B', 1)
      const codes = []
      for (const tag of ['A', 'A', 'B', 'A']) codes.push((await ticketDao.callNext(db, day, 2, () => tag)).code)
      expect(codes).toEqual(['A001', 'A002', 'B001', 'A003'])

      expect((await ticketDao.getCurrentTicket(db, day, 2)).code).toBe('A003')
    } finally {
      await db.close()
    }
  })

  // CT4: a call that finds nobody does not change the ticket in progress.
  it('keeps the ticket in progress when a call finds nobody', async () => {
    const db = await openOffice('empty-call')
    try {
      await addTickets(db, 'A', 1)
      await ticketDao.callNext(db, day, 1, () => 'A')

      expect(await ticketDao.callNext(db, day, 1, () => null)).toBeNull()

      expect((await ticketDao.getCurrentTicket(db, day, 1)).code).toBe('A001')
    } finally {
      await db.close()
    }
  })

  // CT5: counters are independent: a call of counter 1 does not change counter 2.
  it('keeps a separate ticket in progress for each counter', async () => {
    const db = await openOffice('independent')
    try {
      await addTickets(db, 'A', 3)
      await ticketDao.callNext(db, day, 1, () => 'A')
      await ticketDao.callNext(db, day, 2, () => 'A')
      await ticketDao.callNext(db, day, 1, () => 'A')

      expect((await ticketDao.getCurrentTicket(db, day, 2)).code).toBe('A002')
      expect((await ticketDao.getCurrentTicket(db, day, 1)).code).toBe('A003')
    } finally {
      await db.close()
    }
  })

  // CT6: a ticket called on a previous day is no longer in progress today.
  it('ignores a ticket in progress from a previous day', async () => {
    const db = await openOffice('yesterday')
    try {
      await addTickets(db, 'A', 1, yesterday)
      await ticketDao.callNext(db, yesterday, 1, () => 'A')
      expect(await ticketDao.getCurrentTicket(db, yesterday, 1)).not.toBeNull()

      expect(await ticketDao.getCurrentTicket(db, day, 1)).toBeNull()
    } finally {
      await db.close()
    }
  })

  // CT7: reset deletes the tickets without a foreign key error and clears the counter column.
  it('returns null after a reset, which clears the counter column', async () => {
    const db = await openOffice('reset')
    try {
      await addTickets(db, 'A', 1)
      await ticketDao.callNext(db, day, 1, () => 'A')

      await expect(ticketDao.reset(db)).resolves.toBeUndefined()

      expect(await ticketDao.getCurrentTicket(db, day, 1)).toBeNull()
      expect(await currentTicketId(db, 1)).toBeNull()
    } finally {
      await db.close()
    }
  })

  // CT8: a finished ticket (served) is no longer in progress.
  it('returns null when the ticket in progress is no longer called', async () => {
    const db = await openOffice('served')
    try {
      await addTickets(db, 'A', 1)
      await ticketDao.callNext(db, day, 1, () => 'A')
      await db.run("UPDATE tickets SET status = 'served' WHERE code = 'A001'")

      expect(await ticketDao.getCurrentTicket(db, day, 1)).toBeNull()
    } finally {
      await db.close()
    }
  })

  // CT9: if updating the counter fails, the whole call is rolled back, ticket update included.
  it('rolls back the ticket update when updating the counter fails', async () => {
    const db = await openOffice('atomic')
    try {
      await addTickets(db, 'A', 1)
      await db.run("CREATE TRIGGER fail_counter BEFORE UPDATE ON counters BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")

      await expect(ticketDao.callNext(db, day, 1, () => 'A')).rejects.toThrow('simulated failure')

      expect(await db.all('SELECT code, status, counter_id, called_at FROM tickets')).toEqual([
        { code: 'A001', status: 'waiting', counter_id: null, called_at: null },
      ])
      expect(await currentTicketId(db, 1)).toBeNull()
    } finally {
      await db.close()
    }
  })
})

describe('database migration', () => {
  const oldCounters = 'CREATE TABLE counters (id INTEGER PRIMARY KEY); INSERT INTO counters (id) VALUES (1), (2), (3);'

  // Creates a database of the previous schema version: counters without current_ticket_id.
  function createOldDatabase(databasePath, sql = oldCounters) {
    return new Promise((resolve, reject) => {
      const database = new sqlite3.Database(databasePath, (openError) => {
        if (openError) return reject(openError)
        database.exec(
          sql,
          (execError) => {
            database.close((closeError) => {
              if (execError || closeError) reject(execError || closeError)
              else resolve()
            })
          },
        )
      })
    })
  }

  const columnNames = async (db) => (await db.all('PRAGMA table_info(counters)')).map((column) => column.name)

  // MG1: opening an old database adds the column, with its foreign key, and keeps the existing counters.
  it('adds current_ticket_id to an existing counters table and keeps its rows', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-migration-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    await createOldDatabase(databasePath)

    const db = await openDatabase(databasePath)
    try {
      expect(await columnNames(db)).toContain('current_ticket_id')
      expect(await db.all('PRAGMA foreign_key_list(counters)')).toEqual([
        expect.objectContaining({ table: 'tickets', from: 'current_ticket_id', to: 'id', on_delete: 'SET NULL' }),
      ])
      expect(await db.all('SELECT id, current_ticket_id AS currentTicketId FROM counters ORDER BY id')).toEqual([
        { id: 1, currentTicketId: null },
        { id: 2, currentTicketId: null },
        { id: 3, currentTicketId: null },
      ])
    } finally {
      await db.close()
    }
  })

  // MG2: opening the same database more than once, also at the same time, gives no errors.
  it('can open the same database twice, also in parallel', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-migration-twice-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    await createOldDatabase(databasePath)

    const [first, second] = await Promise.all([openDatabase(databasePath), openDatabase(databasePath)])
    const third = await openDatabase(databasePath)
    try {
      for (const db of [first, second, third]) {
        expect((await columnNames(db)).filter((name) => name === 'current_ticket_id')).toHaveLength(1)
      }
    } finally {
      await first.close()
      await second.close()
      await third.close()
    }
  })

  // MG3: a migration error other than "duplicate column" must not be hidden, and the
  // failed open must close its connection. The old database has the whole schema except
  // the new column, so the open reaches the migration; the file is read-only, so ALTER
  // TABLE fails. Deleting the file afterwards proves the connection was closed (Windows
  // cannot delete a file that is still open).
  it('rejects the open when the migration fails for another reason and closes the connection', async () => {
    const databasePath = path.join(os.tmpdir(), `office-queue-migration-readonly-${Date.now()}-${Math.random()}.db`)
    databasePaths.push(databasePath)
    const schema = await fs.readFile(new URL('../../src/dao/schema.sql', import.meta.url), 'utf8')
    const oldSchema = schema.replace(
      /CREATE TABLE IF NOT EXISTS counters \([\s\S]*?\);/,
      'CREATE TABLE IF NOT EXISTS counters (id INTEGER PRIMARY KEY);',
    )
    expect(oldSchema).not.toContain('current_ticket_id')
    await createOldDatabase(databasePath, oldSchema)

    await fs.chmod(databasePath, 0o444)
    try {
      await expect(openDatabase(databasePath)).rejects.toThrow(/readonly/)
    } finally {
      await fs.chmod(databasePath, 0o666)
    }

    await expect(fs.rm(databasePath)).resolves.toBeUndefined()
  })

  // Fake sqlite3 connection for migrate: counters has only the id column,
  // and ALTER TABLE fails with the given error.
  const fakeConnection = (alterError) => ({
    all: (sql, parameters, callback) => callback(null, [{ name: 'id' }]),
    run: (sql, parameters, callback) => callback(alterError),
  })

  // MG4: another connection added the column first ("duplicate column name"): not an error.
  it('ignores a duplicate column error from a concurrent migration', async () => {
    const duplicate = new Error('SQLITE_ERROR: duplicate column name: current_ticket_id')

    await expect(migrate(fakeConnection(duplicate))).resolves.toBeUndefined()
  })

  // MG5: any other migration error reaches the caller.
  it('rethrows any other migration error', async () => {
    const ioError = new Error('SQLITE_IOERR: disk I/O error')

    await expect(migrate(fakeConnection(ioError))).rejects.toBe(ioError)
  })
})
