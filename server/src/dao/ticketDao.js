// Create a ticket atomically, including its service sequence and generated id.
export async function addTicket(db, serviceType, day, issuedAt = new Date().toISOString()) {
  await db.run('BEGIN IMMEDIATE')
  try {
    const sequence = await db.get(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS number FROM tickets WHERE service_tag = ? AND queue_day = ?',
      [serviceType, day],
    )
    const code = `${serviceType}${String(sequence.number).padStart(3, '0')}`
    const result = await db.run(
      `INSERT INTO tickets (code, service_tag, sequence_number, issued_at, status, queue_day)
       VALUES (?, ?, ?, ?, 'waiting', ?)`,
      [code, serviceType, sequence.number, issuedAt, day],
    )
    const row = await db.get(
      `SELECT id, code, service_tag AS serviceType, issued_at AS issuedAt, status
       FROM tickets WHERE id = ?`,
      [result.lastID],
    )
    await db.run('COMMIT')
    return { ...ticketFromRow(row), status: 'waiting' }
  } catch (error) {
    await db.run('ROLLBACK')
    throw error
  }
}

// Map database column names to the public ticket shape.
function ticketFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    serviceType: row.serviceType,
    ...(row.issuedAt ? { issuedAt: row.issuedAt } : {}),
    ...(row.status && row.status !== 'waiting' ? { status: row.status } : {}),
  }
}

// Inspect the first waiting ticket without changing its status.
export async function peek(db, tag, day) {
  const row = await db.get(
    `SELECT id, code, service_tag AS serviceType, issued_at AS issuedAt, status
    FROM tickets WHERE service_tag = ? AND queue_day = ? AND status = 'waiting'
     ORDER BY id LIMIT 1`,
    [tag, day],
  )
  return ticketFromRow(row)
}

// Select and mark the first waiting ticket in one transaction.
export async function dequeue(db, tag, day, counterId = null) {
  await db.run('BEGIN IMMEDIATE')
  try {
    const row = await db.get(
      `SELECT id, code, service_tag AS serviceType, issued_at AS issuedAt, status
       FROM tickets WHERE service_tag = ? AND queue_day = ? AND status = 'waiting' ORDER BY id LIMIT 1`,
      [tag, day],
    )
    if (!row) {
      await db.run('COMMIT')
      return null
    }
    await db.run(
      `UPDATE tickets SET status = 'called', counter_id = ?, called_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [counterId, row.id],
    )
    await db.run('COMMIT')
    return ticketFromRow({ ...row, status: 'called' })
  } catch (error) {
    await db.run('ROLLBACK')
    throw error
  }
}

// Queue length queries only count current-day tickets that are still waiting.
export async function getQueueLength(db, tag, day) {
  const row = await db.get(
    `SELECT COUNT(*) AS length FROM tickets
    WHERE service_tag = ? AND queue_day = ? AND status = 'waiting'`,
    [tag, day],
  )
  return row.length
}

// Return current-day queue lengths keyed by service tag.
export async function getQueueLengths(db, day) {
  const rows = await db.all(
    `SELECT s.tag AS tag,
    COUNT(t.id) AS length FROM services s
    LEFT JOIN tickets t ON t.service_tag = s.tag AND t.queue_day = ? AND t.status = 'waiting'
    GROUP BY s.tag ORDER BY s.rowid`,
    [day],
  )
  return Object.fromEntries(rows.map(({ tag, length }) => [tag, length]))
}

// Return the latest called ticket for each service and counter.
export async function getLastCalledTickets(db, day) {
  const rows = await db.all(
    `SELECT s.tag, s.name, t.code, t.counter_id AS counterId,
      t.called_at AS calledAt
     FROM services s
     LEFT JOIN tickets t ON t.service_tag = s.tag
       AND t.queue_day = ? AND t.status = 'called'
       AND NOT EXISTS (
         SELECT 1 FROM tickets newer
         WHERE newer.service_tag = t.service_tag
           AND newer.queue_day = t.queue_day
           AND newer.status = 'called'
           AND newer.counter_id IS t.counter_id
           AND newer.id > t.id
       )
     ORDER BY s.rowid, t.counter_id, t.id DESC`,
    [day],
  )
  const ticketsCalledByService = {}
  for (const { tag, name, code, counterId, calledAt } of rows) {
    ticketsCalledByService[tag] ??= []
    if (code !== null) ticketsCalledByService[tag].push({ name, code, counterId, calledAt })
  }
  return ticketsCalledByService
}

// Return current-day waiting tickets in FIFO order for one service.
export async function getQueue(db, tag, day) {
  const rows = await db.all(
    `SELECT id, code, service_tag AS serviceType, issued_at AS issuedAt, status
     FROM tickets WHERE service_tag = ? AND queue_day = ? AND status = 'waiting' ORDER BY id`,
    [tag, day],
  )
  return rows.map(ticketFromRow)
}

// Test reset clears tickets; the real daily transition never deletes history.
export async function reset(db) {
  await db.run('DELETE FROM tickets')
  await db.run("DELETE FROM sqlite_sequence WHERE name = 'tickets'")
}
