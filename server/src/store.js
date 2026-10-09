// SQLite-backed data facade used by services and routes.
// Public methods remain isolated from DAO details and return detached values.

import { openDatabase } from './dao/db.js'
import * as officeDao from './dao/officeDao.js'
import * as ticketDao from './dao/ticketDao.js'
import { seedDatabase } from './seed.js'

// Public error for unknown service tags.
export class ServiceNotFoundError extends Error {
  constructor(tag) {
    super(`Unknown service type: ${tag}`)
    this.name = 'ServiceNotFoundError'
    this.tag = tag
  }
}

let databasePromise

// Return the current local date without converting through UTC.
function today() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Lazily open the shared database and seed static office configuration.
async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase().then(async (db) => {
      await seedDatabase(db)
      return db
    })
  }
  return databasePromise
}

// Return a service or raise the public error for invalid tags.
async function requireService(db, tag) {
  const service = await officeDao.getService(db, tag)
  if (!service) throw new ServiceNotFoundError(tag)
  return service
}

// Copy nested service arrays so callers cannot mutate DAO results.
function copyCounter(counter) {
  return { ...counter, services: [...counter.services] }
}

// Return all configured service types in seed order.
export async function getServices() {
  const db = await getDatabase()
  return officeDao.getServices(db)
}

// Return one service, or null when the tag is not configured.
export async function getService(tag) {
  const db = await getDatabase()
  return (await officeDao.getService(db, tag)) || null
}

// Return all counters with their supported service tags.
export async function getCounters() {
  const db = await getDatabase()
  const counters = await officeDao.getCounters(db)
  return counters.map(copyCounter)
}

// Return one counter, or null when its numeric id is not configured.
export async function getCounter(id) {
  const db = await getDatabase()
  const counter = await officeDao.getCounter(db, id)
  return counter ? copyCounter(counter) : null
}

// Add a ticket to the current day's waiting queue.
export async function addTicket(ticket) {
  const db = await getDatabase()
  const serviceType = ticket?.serviceType
  await requireService(db, serviceType)
  return ticketDao.addTicket(db, serviceType, today(), ticket.issuedAt)
}

// Mark and return the first waiting ticket for a service.
export async function dequeue(tag, counterId = null) {
  const db = await getDatabase()
  await requireService(db, tag)
  return ticketDao.dequeue(db, tag, today(), counterId)
}

// Inspect the first waiting ticket without removing it.
export async function peek(tag) {
  const db = await getDatabase()
  await requireService(db, tag)
  return ticketDao.peek(db, tag, today())
}

// Return the number of waiting tickets for one service.
export async function getQueueLength(tag) {
  const db = await getDatabase()
  await requireService(db, tag)
  return ticketDao.getQueueLength(db, tag, today())
}

// Return waiting-ticket counts for every configured service.
export async function getQueueLengths() {
  const db = await getDatabase()
  return ticketDao.getQueueLengths(db, today())
}

// Return all waiting tickets for a service in FIFO order.
export async function getQueue(tag) {
  const db = await getDatabase()
  await requireService(db, tag)
  return ticketDao.getQueue(db, tag, today())
}

// Clear tickets for test isolation; daily operation never calls this method.
export async function reset() {
  const db = await getDatabase()
  return ticketDao.reset(db)
}

// Close the shared database connection when tests or the process finish.
export async function close() {
  if (!databasePromise) return
  const db = await databasePromise
  await db.close()
  databasePromise = undefined
}
