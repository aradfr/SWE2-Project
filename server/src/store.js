// In-memory data store: the single access point to application data.
// The rest of the server must use only these exported functions, so the
// storage can later be replaced (e.g. with SQLite) without touching callers.
//
// Rules:
// - every public function calls ensureToday() first, so queues and per-service
//   counters are reset automatically when the day changes;
// - no internal reference ever leaves the store: only copies or primitives.
//
// The store only keeps data: it does not create tickets nor decide their
// code format (that belongs to the ticket service).

import { Queue } from './queue.js'
import { SERVICES, COUNTERS } from './seed.js'

// Thrown when a service tag does not match any service type.
export class ServiceNotFoundError extends Error {
  constructor(tag) {
    super(`Unknown service type: ${tag}`)
    this.name = 'ServiceNotFoundError'
    this.tag = tag
  }
}

// ---- Internal state (one instance for the whole application) ----
// Invariant: the keys of `sequences` and `queues` are exactly the SERVICES tags.

let day = today() // local date (YYYY-MM-DD) the queues and counters refer to
const sequences = new Map() // tag -> last number issued for that service
const queues = new Map() // tag -> Queue of waiting tickets (FIFO)
let lastId = 0 // last global ticket id; NOT reset when the day changes

for (const { tag } of SERVICES) {
  sequences.set(tag, 0)
  queues.set(tag, new Queue())
}

// ---- Private helpers ----

// Current local date as YYYY-MM-DD. This is the only place the date is read.
// toISOString() is not used because it is UTC and would return the previous
// day right after local midnight.
function today() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Empties all queues and resets per-service counters to 0.
function clearDailyData() {
  for (const queue of queues.values()) queue.clear()
  for (const tag of sequences.keys()) sequences.set(tag, 0)
}

// New day: queues and per-service counters start from scratch.
// lastId is kept so ticket ids stay unique across days.
function ensureToday() {
  const current = today()
  if (current !== day) {
    clearDailyData()
    day = current
  }
}

// Returns the internal queue for a tag. Never return it to callers.
// Throws ServiceNotFoundError for unknown tags (including non-string values).
function getQueueOrThrow(tag) {
  const queue = queues.get(tag)
  if (!queue) throw new ServiceNotFoundError(tag)
  return queue
}

function copyCounter(counter) {
  return { ...counter, services: [...counter.services] }
}

// ---- Services and counters ----

// All service types, in seed order.
export function getServices() {
  ensureToday()
  return SERVICES.map((service) => ({ ...service }))
}

// The service with the given tag, or null if it does not exist (never throws).
export function getService(tag) {
  ensureToday()
  const service = SERVICES.find((s) => s.tag === tag)
  return service ? { ...service } : null
}

// All counters, each with the list of service tags it serves.
export function getCounters() {
  ensureToday()
  return COUNTERS.map(copyCounter)
}

// The counter with the given numeric id, or null if it does not exist.
export function getCounter(id) {
  ensureToday()
  const counter = COUNTERS.find((c) => c.id === id)
  return counter ? copyCounter(counter) : null
}

// ---- Numbering ----

// Next number for a service (1, 2, 3...). Restarts from 1 every day.
// Throws ServiceNotFoundError for unknown tags.
export function nextSequence(tag) {
  ensureToday()
  getQueueOrThrow(tag) // validates the tag
  const next = sequences.get(tag) + 1
  sequences.set(tag, next)
  return next
}

// Next global ticket id (1, 2, 3...). Never restarts when the day changes.
export function nextId() {
  ensureToday()
  lastId++
  return lastId
}

// ---- Queues ----

// Appends a copy of the ticket to the queue of ticket.serviceType.
// Other ticket fields are not validated here.
// Throws ServiceNotFoundError for unknown service types.
export function addTicket(ticket) {
  ensureToday()
  getQueueOrThrow(ticket.serviceType).enqueue({ ...ticket })
}

// Removes and returns the first ticket of the service queue, or null if empty.
// The ticket is no longer stored, so it is returned as is.
export function dequeue(tag) {
  ensureToday()
  return getQueueOrThrow(tag).dequeue()
}

// Copy of the first ticket of the service queue (not removed), or null if empty.
export function peek(tag) {
  ensureToday()
  const ticket = getQueueOrThrow(tag).peek()
  return ticket ? { ...ticket } : null
}

// Number of tickets waiting for a service.
export function getQueueLength(tag) {
  ensureToday()
  return getQueueOrThrow(tag).size()
}

// Waiting tickets per service as a plain object, e.g. { A: 2, B: 0, C: 1 }.
// Keys follow the seed order of services.
export function getQueueLengths() {
  ensureToday()
  const lengths = {}
  for (const { tag } of SERVICES) lengths[tag] = queues.get(tag).size()
  return lengths
}

// Copies of the tickets waiting for a service, from first to last.
export function getQueue(tag) {
  ensureToday()
  return getQueueOrThrow(tag).toArray().map((ticket) => ({ ...ticket }))
}

// ---- Reset ----

// Full reset: empties queues, resets all counters (lastId included) and sets
// the day to today. Used by tests and by POST /api/test/reset.
export function reset() {
  clearDailyData()
  lastId = 0
  day = today()
}
