/* Next customer service: business logic of the "Next customer" story. */

import { getCounter, getServices, callNext } from '../store.js'

// Thrown when a counter id does not match any counter.
export class CounterNotFoundError extends Error {
  constructor(id) {
    super(`Unknown counter: ${id}`)
    this.name = 'CounterNotFoundError'
    this.id = id
  }
}


// Chooses the queue to serve among the services of a counter
export function selectQueue(candidates) {
  let best = null
  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    if (
      best === null ||
      candidate.length > best.length ||
      (candidate.length === best.length && candidate.serviceTime < best.serviceTime)
    ) {
      best = candidate
    }
  }
  return best === null ? null : best.tag
}

// Builds the candidates for selectQueue: one entry per service of the counter,
// with its service time and the current length of its queue
export function buildCandidates(counterServices, services, lengths) {
  return services
    .filter((service) => counterServices.includes(service.tag))
    .map((service) => ({
      tag: service.tag,
      serviceTime: service.serviceTime,
      length: lengths[service.tag] ?? 0,
    }))
}


export async function callNextCustomer(counterId) {
  const counter = await getCounter(counterId)
  if (counter === null) throw new CounterNotFoundError(counterId)

  // Service times are static configuration: they can be read outside the transaction
  const services = await getServices()

  // Queue lengths are read, the queue is chosen and its first ticket is called
  // in one DB transaction, so concurrent counters never use stale lengths
  const ticket = await callNext(counter.id, (lengths) =>
    selectQueue(buildCandidates(counter.services, services, lengths)))

  return ticket === null ? null : { ...ticket, counterId: counter.id }
}
