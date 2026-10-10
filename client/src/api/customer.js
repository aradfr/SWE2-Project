// API calls of the customer role ("Get ticket" story).
// Pages import these functions instead of calling fetch directly, so the
// HTTP details stay in one place (see api/client.js and docs/openapi.yaml).

import { apiFetch } from './client.js'

/**
 * A service type. Mirrors the Service schema in docs/openapi.yaml.
 * @typedef {object} Service
 * @property {string} tag - Short identifier, e.g. 'A'.
 * @property {string} name - Display name, e.g. 'Payments'.
 * @property {number} serviceTime - Average service time in minutes.
 */

/**
 * A ticket issued to a customer. Mirrors the Ticket schema in docs/openapi.yaml.
 * @typedef {object} Ticket
 * @property {number} id - Global id.
 * @property {string} code - Wait-list code shown to the customer, e.g. 'A001'.
 * @property {string} serviceType - Service tag, e.g. 'A'.
 * @property {string} issuedAt - Issue time as an ISO date-time string.
 * @property {'waiting'|'called'|'served'} status - Ticket status.
 */

/**
 * Lists the service types the customer can choose from (GET /api/services).
 * @returns {Promise<Service[]>}
 * @throws {import('./client.js').ApiError} If the server answers with an error.
 */
export async function getServices() {
  const data = await apiFetch('/services')
  return data.services
}

/**
 * Takes a ticket for a service type (POST /api/tickets).
 * @param {string} serviceType - Service tag, e.g. 'A'.
 * @returns {Promise<Ticket>} The new ticket.
 * @throws {import('./client.js').ApiError} 400 for an invalid request,
 *   404 for an unknown service type.
 */
export async function createTicket(serviceType) {
  return apiFetch('/tickets', { method: 'POST', body: { serviceType } })
}
