/* Next customer service: business logic of the "Next customer" story. */

import { getCounter, getServices, getQueueLengths, dequeue } from '../store.js'

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


// Calls the next customer to a counter: chooses the queue with selectQueue
// and marks its first ticket as called by this counter
export async function callNextCustomer(counterId) {
  const counter = await getCounter(counterId)
  if (counter === null) throw new CounterNotFoundError(counterId)

  // Two queries instead of one per service: all service times and all queue lengths.
  const [services, lengths] = await Promise.all([getServices(), getQueueLengths()])

  const tag = selectQueue(buildCandidates(counter.services, services, lengths))
  if (tag === null) return null

  // dequeue saves the counter id and the call time on the ticket (status 'called')
  // It returns null if another counter took the last ticket in the meantime
  const ticket = await dequeue(tag, counter.id)
  return ticket === null ? null : { ...ticket, counterId: counter.id }
}
