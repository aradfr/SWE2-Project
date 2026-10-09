import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { SERVICES, COUNTERS } from '../../src/seed.js'
import {
  ServiceNotFoundError,
  getServices,
  getService,
  getCounters,
  getCounter,
  addTicket,
  dequeue,
  peek,
  getQueueLength,
  getQueueLengths,
  getQueue,
  reset,
  close,
} from '../../src/store.js'

// Expected seed values are copied so tests also verify that callers cannot mutate storage.
const seedServices = () => SERVICES.map((service) => ({ ...service }))
const seedCounters = () => COUNTERS.map((counter) => ({ ...counter, services: [...counter.services] }))

describe('store', () => {
  beforeEach(async () => {
    // Each test starts from an empty operational database state.
    await reset()
  })

  afterAll(async () => {
    await close()
  })

  it('returns services and counters as mutable copies', async () => {
    expect(await getServices()).toEqual(seedServices())
    expect(await getCounters()).toEqual(seedCounters())

    const services = await getServices()
    services[0].name = 'CHANGED'
    services.push({ tag: 'X' })
    const counters = await getCounters()
    counters[0].services.push('C')
    counters[0].id = 42

    expect(await getServices()).toEqual(seedServices())
    expect(await getCounters()).toEqual(seedCounters())
  })

  it('finds services and counters, returning null for missing values', async () => {
    expect(await getService('A')).toEqual({ ...SERVICES[0] })
    expect(await getCounter(2)).toEqual({ id: 2, services: ['A', 'B'] })
    expect(await getService('Z')).toBeNull()
    expect(await getService(undefined)).toBeNull()
    expect(await getCounter('2')).toBeNull()
  })

  it('creates service-specific codes and persistent ids atomically', async () => {
    expect(await addTicket({ serviceType: 'A' })).toMatchObject({
      id: 1,
      code: 'A001',
      serviceType: 'A',
      status: 'waiting',
    })
    expect(await addTicket({ serviceType: 'A' })).toMatchObject({ id: 2, code: 'A002' })
    expect(await addTicket({ serviceType: 'B' })).toMatchObject({ id: 3, code: 'B001' })
  })

  it('stores tickets in FIFO queues and marks the first one as called', async () => {
    await addTicket({ serviceType: 'A' })
    await addTicket({ serviceType: 'A' })
    await addTicket({ serviceType: 'B' })

    expect(await getQueueLengths()).toEqual({ A: 2, B: 1, C: 0 })
    expect((await peek('A')).code).toBe('A001')
    expect((await dequeue('A')).code).toBe('A001')
    expect((await getQueue('A'))[0].code).toBe('A002')
    expect(await getQueueLength('B')).toBe(1)
  })

  it('returns copies and null for empty queues', async () => {
    await addTicket({ serviceType: 'A' })
    const first = await peek('A')
    first.code = 'CHANGED'
    expect((await peek('A')).code).toBe('A001')
    expect(await dequeue('C')).toBeNull()
    expect(await peek('C')).toBeNull()
  })

  it.each(['Z', 'a', '', undefined, null, 1, 'toString', '__proto__'])(
    'rejects unknown service %s', async (tag) => {
      await expect(addTicket({ serviceType: tag })).rejects.toMatchObject({
        name: 'ServiceNotFoundError',
        tag,
      })
      await expect(getQueue(tag)).rejects.toBeInstanceOf(ServiceNotFoundError)
    },
  )

  it('expires waiting tickets logically when the local day changes', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 7, 23, 50))
      await reset()
      await addTicket({ serviceType: 'A' })

      vi.setSystemTime(new Date(2026, 9, 8, 0, 30))
      expect(await getQueueLength('A')).toBe(0)
      expect(await getQueue('A')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
