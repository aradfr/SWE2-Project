import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'

const schemaPath = new URL('./schema.sql', import.meta.url)

// Resolve the production database relative to this module, not the process cwd.
const defaultPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/office_queue.db')

// Adapt sqlite3 callback methods to the Promise API used by the DAOs.
function callbackOperation(database, method, sql, parameters = []) {
  return new Promise((resolve, reject) => {
    database[method](sql, parameters, function onComplete(error, result) {
      if (error) {
        reject(error)
        return
      }
      resolve(method === 'run' ? { lastID: this.lastID, changes: this.changes } : result)
    })
  })
}

// Open and initialize one SQLite connection. Tests can pass their own path.
export async function openDatabase(databasePath = process.env.SQLITE_DB_PATH || defaultPath) {
  await fs.mkdir(path.dirname(databasePath), { recursive: true })
  const schema = await fs.readFile(schemaPath, 'utf8')
  const database = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, (error) => {
      if (error) reject(error)
      else resolve(connection)
    })
  })

  // Enforce all foreign-key relationships declared in schema.sql.
  await run(database, 'PRAGMA foreign_keys = ON')
  // Let a concurrent writer wait briefly for the current transaction to finish.
  await run(database, 'PRAGMA busy_timeout = 5000')
  await exec(database, schema)

  return {
    connection: database,
    run: (sql, parameters) => callbackOperation(database, 'run', sql, parameters),
    get: (sql, parameters) => callbackOperation(database, 'get', sql, parameters),
    all: (sql, parameters) => callbackOperation(database, 'all', sql, parameters),
    exec: (sql) => exec(database, sql),
    close: () => closeDatabase(database),
  }
}

// Execute a statement and expose sqlite3's generated id/change count.
function run(database, sql, parameters = []) {
  return callbackOperation(database, 'run', sql, parameters)
}

// Apply the DDL script in one sqlite3 exec operation.
function exec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => (error ? reject(error) : resolve()))
  })
}

// Close the connection through a Promise so callers can await cleanup.
function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()))
  })
}

export { defaultPath }