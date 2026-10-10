// API functions of the officer role. Pages use only these functions:
// they do not know URLs or response shapes.
import { apiFetch } from './client.js'

export { ApiError } from './client.js'

// ---- TEMP MOCK (OQM-21): remove when GET /api/services is in this branch ----
// Set MOCK_SERVICES to false, check the page, then delete all the TEMP MOCK blocks.
const MOCK_SERVICES = true

// Service types of the server seed (server/src/seed.js).
const MOCK_SERVICE_LIST = [
  { tag: 'A', name: 'Payments', serviceTime: 3 },
  { tag: 'B', name: 'Banking', serviceTime: 5 },
  { tag: 'C', name: 'Shipping', serviceTime: 10 },
]
// ---- END TEMP MOCK ----

/**
 * @typedef {object} Ticket
 * @property {number} id
 * @property {string} code - E.g. 'A001'.
 * @property {string} serviceType - Service tag, e.g. 'A'.
 * @property {string} issuedAt - ISO date and time.
 * @property {'called'} status
 * @property {number} counterId
 */

/**
 * Lists the counters and the services each one handles.
 * @returns {Promise<{ id: number, services: string[] }[]>}
 * @throws {ApiError} If the server answers with an error status.
 * @throws {Error} If the server cannot be reached.
 */
export async function getCounters() {
  const data = await apiFetch('/counters')
  return data.counters
}

/**
 * Lists the service types offered by the office.
 * @returns {Promise<{ tag: string, name: string, serviceTime: number }[]>}
 * @throws {ApiError} If the server answers with an error status.
 * @throws {Error} If the server cannot be reached.
 */
export async function getServices() {
  // ---- TEMP MOCK ----
  if (MOCK_SERVICES) return MOCK_SERVICE_LIST.map((service) => ({ ...service }))
  // ---- END TEMP MOCK ----
  const data = await apiFetch('/services')
  return data.services
}

/**
 * Calls the next customer to a counter.
 * @param {number} counterId
 * @returns {Promise<Ticket | null>} The called ticket, or null if nobody is waiting.
 * @throws {ApiError} status 404 for an unknown counter, 400 for an invalid id,
 *   other statuses for server errors.
 * @throws {Error} If the server cannot be reached.
 */
export function callNextCustomer(counterId) {
  return apiFetch(`/counters/${counterId}/next`, { method: 'POST' })
}

/**
 * The ticket currently called by the counter (last called today, not finished), or null.
 * @param {number} counterId
 * @returns {Promise<Ticket | null>}
 * @throws {ApiError} If the server answers with an error status.
 * @throws {Error} If the server cannot be reached.
 */
export async function getCurrentTicket(counterId) {
  // ---- TEMP: no API yet (current ticket of a counter) ----
  // Replace with the call to the API when it exists.
  void counterId
  return null
  // ---- END TEMP ----
}
