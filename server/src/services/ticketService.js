// Ticket service: business logic of the "Get ticket" story.
// It knows nothing about HTTP: routes call it and map errors to status codes.
// Store calls are always awaited, so this service works with both the
// in-memory store and the future async (database) store.

import { addTicket } from '../store.js'

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
 * Issues a new ticket for a service type and adds it to that service's queue.
 * The service is checked first, so an invalid request consumes no number or id.
 * @param {string} serviceType - Exact service tag, e.g. 'A' (no normalization).
 * @returns {Promise<Ticket>} The new ticket.
 */
export async function createTicket(serviceType) {
  return await addTicket({ serviceType })
}
