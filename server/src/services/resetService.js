// Full reset of queues and counters, as happens every morning in the office.
// Exposed over HTTP only in test mode (POST /api/test/reset), so tests can
// start from a known state.

import { reset } from '../store.js'

/**
 * Empties all queues and restarts ticket numbering and ids.
 * @returns {Promise<void>}
 */
export async function resetAll() {
  await reset()
}
