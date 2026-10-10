/* Counter service: list of the office counters and the services they handle.
Used by the officer UI to choose a counter. */

import { getCounters } from '../store.js'

export async function listCounters() {
  return getCounters()
}
