import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../src/dao/db.js'
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
})
