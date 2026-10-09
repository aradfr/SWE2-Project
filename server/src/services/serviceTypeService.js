// Service types offered by the office ("Get ticket" story: the customer
// chooses one of them). No HTTP here: routes call these functions.

import { getServices } from '../store.js'

/**
 * A service type. Mirrors the Service schema in docs/openapi.yaml.
 * @typedef {object} Service
 * @property {string} tag - Short identifier, e.g. 'A'.
 * @property {string} name - Display name, e.g. 'Payments'.
 * @property {number} serviceTime - Average service time in minutes.
 */

/**
 * Lists all service types, in seed order.
 * @returns {Promise<Service[]>} Copies of the service types.
 */
export async function listServices() {
  return await getServices()
}
