import { describe, it, expect } from 'vitest'
import { SERVICES, COUNTERS } from '../../src/seed.js'

describe('seed', () => {
  // Seed data is shared by the whole app: it must not be changeable at runtime.
  it('freezes SERVICES, COUNTERS, every object inside them and every services array', () => {
    expect(Object.isFrozen(SERVICES)).toBe(true)
    expect(Object.isFrozen(COUNTERS)).toBe(true)
    for (const service of SERVICES) expect(Object.isFrozen(service)).toBe(true)
    for (const counter of COUNTERS) {
      expect(Object.isFrozen(counter)).toBe(true)
      expect(Object.isFrozen(counter.services)).toBe(true)
    }
  })

  it('defines valid services: unique string tags, string names, positive integer service times', () => {
    const tags = SERVICES.map((service) => service.tag)
    expect(new Set(tags).size).toBe(tags.length)

    for (const service of SERVICES) {
      expect(typeof service.tag).toBe('string')
      expect(typeof service.name).toBe('string')
      expect(Number.isInteger(service.serviceTime)).toBe(true)
      expect(service.serviceTime).toBeGreaterThan(0)
    }
  })

  it('defines valid counters: unique ids, at least one service each, only existing services', () => {
    const ids = COUNTERS.map((counter) => counter.id)
    expect(new Set(ids).size).toBe(ids.length)

    const tags = SERVICES.map((service) => service.tag)
    for (const counter of COUNTERS) {
      expect(counter.services.length).toBeGreaterThan(0)
      for (const tag of counter.services) expect(tags).toContain(tag)
    }
  })
})
