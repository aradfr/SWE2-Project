// Initial data used by the store until counters can be configured
// (Config counters story) or loaded from a database.
// Data only, no logic. Everything is frozen so it cannot be changed at runtime.

import { seedOffice } from './dao/officeDao.js'

// Service types. serviceTime is the average service time in minutes.
export const SERVICES = Object.freeze([
  Object.freeze({ tag: 'A', name: 'Payments', serviceTime: 3 }),
  Object.freeze({ tag: 'B', name: 'Banking', serviceTime: 5 }),
  Object.freeze({ tag: 'C', name: 'Shipping', serviceTime: 10 }),
])

// Counters and the service types (tags) each one can serve.
export const COUNTERS = Object.freeze([
  Object.freeze({ id: 1, services: Object.freeze(['A']) }),
  Object.freeze({ id: 2, services: Object.freeze(['A', 'B']) }),
  Object.freeze({ id: 3, services: Object.freeze(['C']) }),
])

export function seedDatabase(db) {
  return seedOffice(db, SERVICES, COUNTERS)
}
