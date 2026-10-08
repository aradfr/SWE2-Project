// Ticket service: business logic of the "Get ticket" story.
// It knows nothing about HTTP: routes call it and map errors to status codes.
// Store calls are always awaited, so this service works with both the
// in-memory store and the future async (database) store.

import { getService, nextSequence, nextId, addTicket, ServiceNotFoundError } from '../store.js'

// Re-exported so routes can import everything they need from the service.
export { ServiceNotFoundError } from '../store.js'

/**
 * A ticket issued to a customer. Mirrors the Ticket schema in docs/openapi.yaml.
 * @typedef {object} Ticket
 * @property {number} id - Global id, never reset.
 * @property {string} code - Wait-list code, e.g. 'A001'.
 * @property {string} serviceType - Service tag, e.g. 'A'.
 * @property {string} issuedAt - Issue time as an ISO date-time string.
 * @property {'waiting'|'called'|'served'} status - Ticket status.
 */

/**
 * Builds the wait-list code shown to the customer: service tag + 3-digit number.
 * The number restarts from 001 after 999 (1000 -> 001, 1001 -> 002).
 * Arguments are not validated: createTicket always passes valid values.
 * @param {string} tag - Service tag, e.g. 'A'.
 * @param {number} n - Per-service sequence number (1, 2, 3...).
 * @returns {string} The ticket code, e.g. 'A001'.
 */
export function formatCode(tag, n) {
  const shown = ((n - 1) % 999) + 1
  return `${tag}${String(shown).padStart(3, '0')}`
}

/**
 * Issues a new ticket for a service type and adds it to that service's queue.
 * The service is checked first, so an invalid request consumes no number or id.
 * @param {string} serviceType - Exact service tag, e.g. 'A' (no normalization).
 * @returns {Promise<Ticket>} The new ticket.
 * @throws {ServiceNotFoundError} If serviceType does not match any service (rejected promise).
 */
export async function createTicket(serviceType) {
  if ((await getService(serviceType)) === null) {
    throw new ServiceNotFoundError(serviceType)
  }

  const n = await nextSequence(serviceType)
  const id = await nextId()
  const ticket = {
    id,
    code: formatCode(serviceType, n),
    serviceType,
    issuedAt: new Date().toISOString(), // an instant (UTC); the store decides the day
    status: 'waiting',
  }

  await addTicket(ticket)
  return ticket
}
