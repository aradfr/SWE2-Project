import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { inspect } from 'node:util'
import { SERVICES, COUNTERS } from '../../src/seed.js'
import {
  ServiceNotFoundError,
  getServices,
  getService,
  getCounters,
  getCounter,
  nextSequence,
  nextId,
  addTicket,
  dequeue,
  peek,
  getQueueLength,
  getQueueLengths,
  getQueue,
  reset,
} from '../../src/store.js'

const ticket = (id, serviceType, code) => ({ id, serviceType, code })

// Expected copies of the seed data (plain, mutable objects)
const seedServices = () => SERVICES.map((service) => ({ ...service }))
const seedCounters = () => COUNTERS.map((counter) => ({ ...counter, services: [...counter.services] }))

describe('store', () => {
  beforeEach(() => {
    reset()
  })

  describe('services and counters', () => {
    it('returns the seed services and counters in seed order', () => {
      expect(getServices()).toEqual(seedServices())
      expect(getCounters()).toEqual(seedCounters())
    })

    it('finds a service by tag and a counter by numeric id, and returns null when not found', () => {
      expect(getService('A')).toEqual({ ...SERVICES[0] })
      expect(getCounter(2)).toEqual({ id: 2, services: ['A', 'B'] })

      expect(getService('Z')).toBeNull()
      expect(getService(undefined)).toBeNull()
      expect(getService(null)).toBeNull()
      expect(getService(1)).toBeNull()
      expect(getCounter(99)).toBeNull()
      // The counter id is numeric: a string id is not a match
      expect(getCounter('2')).toBeNull()
    })

    it('returns mutable copies: changing them does not change the store', () => {
      const services = getServices()
      expect(Object.isFrozen(services[0])).toBe(false)
      services[0].name = 'CHANGED'
      services.push({ tag: 'X' })
      getService('A').serviceTime = 999

      const counters = getCounters()
      counters[0].services.push('C')
      counters[0].id = 42
      getCounter(2).services.length = 0

      expect(getServices()).toEqual(seedServices())
      expect(getCounters()).toEqual(seedCounters())
    })
  })

  describe('reset and numbering', () => {
    it('starts with every queue empty, as a plain object keyed in service order', () => {
      const lengths = getQueueLengths()

      expect(lengths).toEqual({ A: 0, B: 0, C: 0 })
      expect(Object.keys(lengths)).toEqual(['A', 'B', 'C'])
      expect(Object.getPrototypeOf(lengths)).toBe(Object.prototype)
    })

    it('numbers each service independently from 1 without creating tickets', () => {
      const numbers = [nextSequence('A'), nextSequence('A'), nextSequence('B'), nextSequence('A'), nextSequence('C')]

      expect(numbers).toEqual([1, 2, 1, 3, 1])
      expect(getQueueLengths()).toEqual({ A: 0, B: 0, C: 0 })
    })

    it('issues global ids 1, 2, 3', () => {
      expect([nextId(), nextId(), nextId()]).toEqual([1, 2, 3])
    })

    it('restarts both service numbers and global ids from 1 after reset', () => {
      nextSequence('A')
      nextSequence('A')
      nextId()
      nextId()

      reset()

      expect(nextSequence('A')).toBe(1)
      expect(nextId()).toBe(1)
    })
  })

  describe('queues', () => {
    it('adds tickets to the queue of their service, in arrival order', () => {
      addTicket(ticket(1, 'A', 'A001'))
      addTicket(ticket(2, 'A', 'A002'))
      addTicket(ticket(3, 'B', 'B001'))
      addTicket(ticket(4, 'A', 'A003'))

      expect(getQueueLengths()).toEqual({ A: 3, B: 1, C: 0 })
      expect([getQueueLength('A'), getQueueLength('B'), getQueueLength('C')]).toEqual([3, 1, 0])
      expect(getQueue('A').map((t) => t.code)).toEqual(['A001', 'A002', 'A003'])
      expect(getQueue('C')).toEqual([])
    })

    it('dequeues the first ticket of a service, removes it and leaves other queues untouched', () => {
      addTicket(ticket(1, 'A', 'A001'))
      addTicket(ticket(2, 'A', 'A002'))
      addTicket(ticket(3, 'B', 'B001'))

      expect(dequeue('A')).toEqual(ticket(1, 'A', 'A001'))
      expect(getQueueLength('A')).toBe(1)
      expect(peek('A').code).toBe('A002')
      expect(getQueueLength('B')).toBe(1)
      expect(getQueueLength('C')).toBe(0)
      expect(dequeue('B').code).toBe('B001')
    })

    it('returns null from dequeue and peek when the queue is empty', () => {
      expect(dequeue('B')).toBeNull()
      expect(dequeue('C')).toBeNull()
      expect(peek('C')).toBeNull()
    })

    it('peeks a copy of the first ticket without removing it', () => {
      addTicket(ticket(1, 'A', 'A001'))

      peek('A').code = 'CHANGED'

      expect(peek('A').code).toBe('A001')
      expect(getQueueLength('A')).toBe(1)
    })

    // Tickets are stored and returned as copies, so callers can never
    // change the waiting line by mistake.
    it('stores a copy of each added ticket and returns copies from getQueue', () => {
      const original = ticket(1, 'A', 'A001')
      addTicket(original)
      addTicket(ticket(2, 'A', 'A002'))

      original.code = 'MUTATED-AFTER-ADD'
      expect(peek('A')).toEqual(ticket(1, 'A', 'A001'))

      const waiting = getQueue('A')
      waiting[0].code = 'CHANGED'
      waiting.pop()
      waiting.push({ code: 'FAKE' })
      expect(getQueue('A').map((t) => t.code)).toEqual(['A001', 'A002'])
    })

    it('reuses a queue after it is drained, and reset empties every queue', () => {
      addTicket(ticket(1, 'A', 'A001'))
      addTicket(ticket(2, 'A', 'A002'))
      expect([dequeue('A').code, dequeue('A').code, dequeue('A')]).toEqual(['A001', 'A002', null])

      addTicket(ticket(3, 'A', 'A003'))
      expect(getQueue('A').map((t) => t.code)).toEqual(['A003'])

      addTicket(ticket(4, 'C', 'C001'))
      reset()
      expect(getQueueLengths()).toEqual({ A: 0, B: 0, C: 0 })
    })
  })

  describe('unknown service tags', () => {
    const calls = {
      nextSequence: (tag) => nextSequence(tag),
      dequeue: (tag) => dequeue(tag),
      peek: (tag) => peek(tag),
      getQueueLength: (tag) => getQueueLength(tag),
      getQueue: (tag) => getQueue(tag),
      'addTicket({ serviceType })': (tag) => addTicket({ serviceType: tag }),
    }
    // 'a' checks case sensitivity; 'toString' and '__proto__' check that
    // built-in JavaScript property names are not mistaken for services.
    const badTags = ['Z', 'a', '', undefined, null, 1, 'toString', '__proto__']
    const cases = Object.entries(calls).flatMap(([fn, call]) =>
      badTags.map((tag) => ({ fn, call, tag, label: inspect(tag) })))

    it.each(cases)('$fn throws ServiceNotFoundError for unknown tag $label', ({ call, tag }) => {
      let error
      try {
        call(tag)
      } catch (e) {
        error = e
      }

      expect(error).toBeInstanceOf(ServiceNotFoundError)
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('ServiceNotFoundError')
      expect(error.tag).toBe(tag)
      expect(error.message).toBe(`Unknown service type: ${tag}`)
    })

    it('throws for a ticket without serviceType and leaves the store unchanged after failed calls', () => {
      expect(() => addTicket({})).toThrow(ServiceNotFoundError)
      expect(() => nextSequence('Z')).toThrow(ServiceNotFoundError)
      expect(() => addTicket({ serviceType: 'Z' })).toThrow(ServiceNotFoundError)
      expect(() => dequeue('Z')).toThrow(ServiceNotFoundError)

      expect(getQueueLengths()).toEqual({ A: 0, B: 0, C: 0 })
      expect(nextSequence('A')).toBe(1)
    })
  })

  describe('day change', () => {
    // Sets the fake clock to a local date and time (month is 1-12)
    const setClock = (year, month, day, hour = 9, minute = 0) => {
      vi.setSystemTime(new Date(year, month - 1, day, hour, minute))
    }

    // Day 7: counters in use and tickets waiting on A and B (ids 1 and 2).
    // Then the clock moves to the morning of day 8.
    const prepareYesterdayThenMorning = () => {
      setClock(2026, 10, 7, 9)
      reset()
      nextSequence('A')
      nextSequence('A')
      nextSequence('B')
      addTicket(ticket(nextId(), 'A', 'A001'))
      addTicket(ticket(nextId(), 'B', 'B001'))
      setClock(2026, 10, 8, 8)
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps queues and service numbers later on the same day', () => {
      setClock(2026, 10, 7, 8)
      reset()
      addTicket(ticket(1, 'A', 'A001'))
      nextSequence('A')

      setClock(2026, 10, 7, 18)

      expect(getQueueLength('A')).toBe(1)
      expect(nextSequence('A')).toBe(2)
    })

    // Each check starts again from yesterday, so the function under test is
    // always the first call of the new day.
    it('starts a new day with empty queues and service numbers from 1, while global ids continue', () => {
      prepareYesterdayThenMorning()
      expect(getQueueLengths()).toEqual({ A: 0, B: 0, C: 0 })

      prepareYesterdayThenMorning()
      expect(dequeue('A')).toBeNull()

      prepareYesterdayThenMorning()
      expect(peek('B')).toBeNull()

      prepareYesterdayThenMorning()
      expect(getQueueLength('A')).toBe(0)

      prepareYesterdayThenMorning()
      expect(getQueue('A')).toEqual([])

      prepareYesterdayThenMorning()
      expect(nextSequence('A')).toBe(1)

      prepareYesterdayThenMorning()
      addTicket(ticket(99, 'A', 'A001'))
      expect(getQueue('A').map((t) => t.id)).toEqual([99])

      prepareYesterdayThenMorning()
      expect(nextId()).toBe(3)
    })

    // Checks that EACH public function calls ensureToday(), in isolation.
    // Day 7 with a ticket -> clock to day 8 -> call ONLY the function -> clock
    // back to day 7. If the function moved the store to day 8, going back to
    // day 7 is another day change and the queue is empty. If it did not, the
    // store is still on day 7 and yesterday's ticket is still there.
    // (Checking with a second function would hide the bug, because that
    // function would call ensureToday() itself.)
    it.each([
      ['getServices', () => getServices()],
      ['getService', () => getService('A')],
      ['getCounters', () => getCounters()],
      ['getCounter', () => getCounter(1)],
      ['nextSequence', () => nextSequence('B')],
      ['nextId', () => nextId()],
      ['addTicket', () => addTicket(ticket(50, 'C', 'C001'))],
      ['dequeue', () => dequeue('C')],
      ['peek', () => peek('C')],
      ['getQueueLength', () => getQueueLength('C')],
      ['getQueueLengths', () => getQueueLengths()],
      ['getQueue', () => getQueue('C')],
    ])('%s detects the new day on its own', (_name, call) => {
      prepareYesterdayThenMorning()
      call()
      setClock(2026, 10, 7, 10)

      expect(getQueueLength('A')).toBe(0)
    })

    // The day is the LOCAL date: 00:30 in Italy is still the previous day in
    // UTC, so a date built with toISOString() would miss the change.
    it('treats local midnight as a new day (23:50 -> 00:30)', () => {
      setClock(2026, 10, 7, 23, 50)
      reset()
      addTicket(ticket(1, 'A', 'A001'))

      setClock(2026, 10, 8, 0, 30)

      expect(getQueueLength('A')).toBe(0)
    })

    it('empties the queues when the year changes (31/12 -> 01/01)', () => {
      setClock(2026, 12, 31, 17)
      reset()
      addTicket(ticket(1, 'C', 'C001'))

      setClock(2027, 1, 1, 8)

      expect(getQueueLength('C')).toBe(0)
    })

    it('does not empty the queues again later on the day of a reset', () => {
      setClock(2026, 10, 9, 8)
      reset()
      addTicket(ticket(1, 'A', 'A001'))

      setClock(2026, 10, 9, 12)

      expect(getQueueLength('A')).toBe(1)
    })
  })
})
