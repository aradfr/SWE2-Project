import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getCounter, getServices, callNext } from '../../src/store.js'
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
  callNext: vi.fn(),
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

// Behaves like store.callNext: applies the choice to the current queue lengths
// (only services with waiting tickets) and calls the first ticket of the chosen queue.
const fakeCallNext = (lengths) => async (counterId, choose) => {
  const tag = choose(lengths)
  return tag === null ? null : fakeTicket(tag)
}

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

  // PO: no preference on a full tie; the team keeps the configuration order (first candidate wins).
  it('on equal length and service time keeps the first candidate (A listed first)', () => {
    const candidates = [
      { tag: 'A', serviceTime: 3, length: 2 },
      { tag: 'B', serviceTime: 3, length: 2 },
    ]
    expect(selectQueue(candidates)).toBe('A')
  })

  // PO: no preference on a full tie; the team keeps the configuration order (first candidate wins).
  it('on equal length and service time keeps the first candidate (B listed first)', () => {
    const candidates = [
      { tag: 'B', serviceTime: 3, length: 2 },
      { tag: 'A', serviceTime: 3, length: 2 },
    ]
    expect(selectQueue(candidates)).toBe('B')
  })

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
    // Default store: counter 2 of the seed (A, B), seed services, no waiting tickets.
    vi.resetAllMocks()
    getCounter.mockImplementation(async (id) => (id === 2 ? { id: 2, services: ['A', 'B'] } : null))
    getServices.mockResolvedValue(seedServices())
    callNext.mockImplementation(fakeCallNext({}))
  })

  // Returns the choice function that callNextCustomer passed to store.callNext.
  const captureChoose = async () => {
    await callNextCustomer(2)
    return callNext.mock.calls[0][1]
  }

  // An unknown counter is an error, and no ticket must be taken from any queue.
  it('throws CounterNotFoundError for an unknown counter', async () => {
    callNext.mockImplementation(fakeCallNext({ A: 1, B: 1, C: 1 }))

    const error = await callNextCustomer(99).catch((err) => err)

    expect(error).toBeInstanceOf(CounterNotFoundError)
    expect(error.id).toBe(99)
    expect(error.name).toBe('CounterNotFoundError')
    expect(callNext).not.toHaveBeenCalled()
  })

  // Nobody is called when only a service the counter does not handle has customers.
  it('returns null when the counter queues are empty', async () => {
    callNext.mockImplementation(fakeCallNext({ C: 5 }))

    expect(await callNextCustomer(2)).toBeNull()
  })

  // The ticket is called once for this counter, from the longest queue, and returned with the counter id.
  it('calls the first ticket of the chosen queue for this counter and adds the counter id', async () => {
    callNext.mockImplementation(fakeCallNext({ A: 1, B: 3 }))

    const result = await callNextCustomer(2)

    expect(callNext).toHaveBeenCalledTimes(1)
    expect(callNext.mock.calls[0][0]).toBe(2)
    expect(result).toMatchObject({ code: 'B001', status: 'called', counterId: 2 })
  })

  // A longer queue of a service the counter does not handle must not be chosen.
  it('ignores queues of services the counter does not handle', async () => {
    callNext.mockImplementation(fakeCallNext({ A: 1, C: 9 }))

    const result = await callNextCustomer(2)

    expect(result).toMatchObject({ code: 'A001' })
  })

  // A counter without services has nothing to serve, even if every queue has customers.
  it('returns null for a counter without services', async () => {
    getCounter.mockResolvedValue({ id: 4, services: [] })
    callNext.mockImplementation(fakeCallNext({ A: 1, B: 1, C: 1 }))

    expect(await callNextCustomer(4)).toBeNull()
  })

  // A failure while calling the ticket must reach the caller, not be hidden as "nobody to call".
  it('propagates a store error instead of returning null', async () => {
    const storeError = new Error('DB down')
    callNext.mockRejectedValue(storeError)

    await expect(callNextCustomer(2)).rejects.toBe(storeError)
  })

  // A failure while reading the services must reach the caller, and no ticket must be called.
  it('propagates an error while reading the services', async () => {
    const storeError = new Error('DB down')
    getServices.mockRejectedValue(storeError)

    await expect(callNextCustomer(2)).rejects.toBe(storeError)
    expect(callNext).not.toHaveBeenCalled()
  })

  // The choice run inside the transaction must apply the selection rule to the counter services only.
  it('passes callNext a choice that applies the selection rule to the counter services', async () => {
    const choose = await captureChoose()

    expect(choose({ A: 2, B: 2 })).toBe('A')
    expect(choose({ A: 1, B: 3 })).toBe('B')
    expect(choose({ C: 9 })).toBeNull()
    expect(choose({})).toBeNull()
  })

  // The store only reports services with waiting tickets: a missing service is an empty queue.
  it('treats services missing from the lengths as empty queues', async () => {
    const choose = await captureChoose()

    expect(choose({ B: 1 })).toBe('B')
  })
})
