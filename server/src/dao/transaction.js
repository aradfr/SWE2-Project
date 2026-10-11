// All requests share one SQLite connection, and SQLite cannot start a
// transaction while another one is open on the same connection.
// Transactions are queued per connection and run one at a time.

const queues = new WeakMap() // connection -> promise of its last transaction

export function transaction(db, work) {
  const previous = queues.get(db) ?? Promise.resolve()
  const current = previous
    .catch(() => {}) // a failed transaction must not block the next ones
    .then(async () => {
      await db.run('BEGIN IMMEDIATE')
      try {
        const result = await work()
        await db.run('COMMIT')
        return result
      } catch (error) {
        await db.run('ROLLBACK')
        throw error
      }
    })
  queues.set(db, current)
  return current
}
