import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getCounter, getServices, getQueueLengths, dequeue } from '../../src/store.js'
import {
  CounterNotFoundError,
  selectQueue,
  buildCandidates,
  callNextCustomer,
} from '../../src/services/nextCustomerService.js'

// The store is replaced by mocks, so no database is opened.
vi.mock('../../src/store.js', () => ({
  getCounter: vi.fn(),
  getServices: vi.fn(),
  getQueueLengths: vi.fn(),
  dequeue: vi.fn(),
}))

// Seed services: A Payments 3 min, B Banking 5 min, C Shipping 10 min.
const seedServices = () => [
  { tag: 'A', name: 'Payments', serviceTime: 3 },
  { tag: 'B', name: 'Banking', serviceTime: 5 },
  { tag: 'C', name: 'Shipping', serviceTime: 10 },
]

const fakeTicket = (tag) => ({
  id: 1,
  code: `${tag}001`,
  serviceType: tag,
  issuedAt: '2026-10-09T09:00:00.000Z',
  status: 'called',
})

describe('selectQueue', () => {
  // The queue length decides first, regardless of service time and order.
  it('chooses the longest queue even if it is slower and listed second', () => {
    const candidates = [
      { tag: 'A', serviceTime: 3, length: 1 },
      { tag: 'B', serviceTime: 5, length: 3 },
    ]
    expect(selectQueue(candidates)).toBe('B')
  })

  // On a length tie the lower service time wins, even when it is not the first candidate.
  it('on equal length chooses the lower service time listed second', () => {
    const candidates = [
      { tag: 'A', serviceTime: 5, length: 2 },
      { tag: 'B', serviceTime: 3, length: 2 },
    ]
    expect(selectQueue(candidates)).toBe('B')
  })

  // On a length tie a later, slower candidate must not replace the faster first one.
  it('on equal length keeps the lower service time listed first', () => {
    const candidates = [
      { tag: 'A', serviceTime: 3, length: 2 },
      { tag: 'B', serviceTime: 5, length: 2 },
    ]
    expect(selectQueue(candidates)).toBe('A')
  })

  // TODO: tie-break rule asked to the PO
  it.todo('on equal length and service time uses the agreed tie-break (A listed first)')

  // TODO: tie-break rule asked to the PO
  it.todo('on equal length and service time uses the agreed tie-break (B listed first)')

  // Nobody can be called when every queue of the counter is empty.
  it('returns null when all queues are empty', () => {
    const candidates = [
      { tag: 'A', serviceTime: 3, length: 0 },
      { tag: 'B', serviceTime: 5, length: 0 },
    ]
    expect(selectQueue(candidates)).toBeNull()
  })

  // A counter with one service serves that queue when it is not empty.
  it('returns the only service of a single-service counter', () => {
    expect(selectQueue([{ tag: 'A', serviceTime: 3, length: 4 }])).toBe('A')
  })

  // An empty queue must never be chosen, even if its service time is lower.
  it('ignores an empty queue even if it has a lower service time', () => {
    const candidates = [
      { tag: 'A', serviceTime: 3, length: 0 },
      { tag: 'B', serviceTime: 5, length: 1 },
    ]
    expect(selectQueue(candidates)).toBe('B')
  })

  // No candidates means there is no queue to serve.
  it('returns null for an empty candidate list', () => {
    expect(selectQueue([])).toBeNull()
  })
})

describe('buildCandidates', () => {
  // Only the counter services are kept, each with its service time and queue length.
  it('keeps only the services of the counter with service time and length', () => {
    const result = buildCandidates(['A', 'B'], seedServices(), { A: 2, B: 0, C: 4 })
    expect(result).toEqual([
      { tag: 'A', serviceTime: 3, length: 2 },
      { tag: 'B', serviceTime: 5, length: 0 },
    ])
  })

  // A service without an entry in the lengths has an empty queue.
  it('uses length 0 when a queue length is missing', () => {
    const result = buildCandidates(['A', 'B'], seedServices(), { A: 2 })
    expect(result).toEqual([
      { tag: 'A', serviceTime: 3, length: 2 },
      { tag: 'B', serviceTime: 5, length: 0 },
    ])
  })

  // A counter without services has no candidates.
  it('returns an empty list for a counter without services', () => {
    expect(buildCandidates([], seedServices(), { A: 2, B: 1, C: 4 })).toEqual([])
  })

  // An unknown service tag on the counter is skipped without errors.
  it('ignores a counter service that is not configured', () => {
    const result = buildCandidates(['A', 'Z'], seedServices(), { A: 1, Z: 5 })
    expect(result).toEqual([{ tag: 'A', serviceTime: 3, length: 1 }])
  })
})

describe('callNextCustomer', () => {
  beforeEach(() => {
    // Default store: counter 2 of the seed (A, B), seed services, dequeue returns a called ticket.
    vi.resetAllMocks()
    getCounter.mockImplementation(async (id) => (id === 2 ? { id: 2, services: ['A', 'B'] } : null))
    getServices.mockResolvedValue(seedServices())
    dequeue.mockImplementation(async (tag) => fakeTicket(tag))
  })

  // An unknown counter is an error, and no ticket must be taken from any queue.
  it('throws CounterNotFoundError for an unknown counter', async () => {
    getQueueLengths.mockResolvedValue({ A: 1, B: 1, C: 1 })

    const error = await callNextCustomer(99).catch((err) => err)

    expect(error).toBeInstanceOf(CounterNotFoundError)
    expect(error.id).toBe(99)
    expect(error.name).toBe('CounterNotFoundError')
    expect(dequeue).not.toHaveBeenCalled()
  })

  // Empty counter queues mean nobody is called, even if another service has customers.
  it('returns null and calls nobody when the counter queues are empty', async () => {
    getQueueLengths.mockResolvedValue({ A: 0, B: 0, C: 5 })

    expect(await callNextCustomer(2)).toBeNull()
    expect(dequeue).not.toHaveBeenCalled()
  })

  // The first ticket of the longest queue is taken for this counter and returned with its id.
  it('calls the first ticket of the chosen queue and adds the counter id', async () => {
    getQueueLengths.mockResolvedValue({ A: 1, B: 3, C: 0 })

    const result = await callNextCustomer(2)

    expect(dequeue).toHaveBeenCalledTimes(1)
    expect(dequeue).toHaveBeenCalledWith('B', 2)
    expect(result).toMatchObject({ code: 'B001', status: 'called', counterId: 2 })
  })

  // A longer queue of a service the counter does not handle must not be chosen.
  it('ignores queues of services the counter does not handle', async () => {
    getQueueLengths.mockResolvedValue({ A: 1, B: 0, C: 9 })

    await callNextCustomer(2)

    expect(dequeue).toHaveBeenCalledWith('A', 2)
  })

  // If another counter takes the last ticket first, the queues are read again and another one is served.
  it('serves another counter queue if the chosen one was emptied meanwhile', async () => {
    getQueueLengths
      .mockResolvedValueOnce({ A: 1, B: 1 })
      .mockResolvedValueOnce({ A: 0, B: 1 })
    dequeue.mockImplementation(async (tag) => (tag === 'A' ? null : fakeTicket(tag)))

    const result = await callNextCustomer(2)

    expect(result).toMatchObject({ code: 'B001', counterId: 2 })
    expect(getQueueLengths).toHaveBeenCalledTimes(2)
  })

  // A counter without services has nothing to serve.
  it('returns null for a counter without services', async () => {
    getCounter.mockResolvedValue({ id: 4, services: [] })
    getQueueLengths.mockResolvedValue({ A: 1, B: 1, C: 1 })

    expect(await callNextCustomer(4)).toBeNull()
    expect(dequeue).not.toHaveBeenCalled()
  })

  // A store failure must reach the caller, not be hidden as "nobody to call".
  it('propagates a store error instead of returning null', async () => {
    const storeError = new Error('DB down')
    getServices.mockRejectedValue(storeError)
    getQueueLengths.mockResolvedValue({ A: 1, B: 1 })

    await expect(callNextCustomer(2)).rejects.toBe(storeError)
  })

  // Under continuous contention the call must end with null after a bounded number of attempts.
  it('gives up after a limited number of attempts instead of looping forever', async () => {
    getQueueLengths.mockResolvedValue({ A: 1, B: 0 })
    dequeue.mockResolvedValue(null)

    expect(await callNextCustomer(2)).toBeNull()
    expect(dequeue.mock.calls.length).toBeLessThanOrEqual(3)
  })
})
