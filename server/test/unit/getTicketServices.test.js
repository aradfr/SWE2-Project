import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getServices, addTicket, reset } from '../../src/store.js'
import { listServices } from '../../src/services/serviceTypeService.js'
import { resetAll } from '../../src/services/resetService.js'
import { createTicket, ServiceNotFoundError } from '../../src/services/ticketService.js'

// The store is replaced by mocks, so no database is opened.
// ServiceNotFoundError stays real: services re-export it and the error handler matches on it.
vi.mock('../../src/store.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ServiceNotFoundError: actual.ServiceNotFoundError,
    getServices: vi.fn(),
    addTicket: vi.fn(),
    reset: vi.fn(),
  }
})

const seedServices = () => [
  { tag: 'A', name: 'Payments', serviceTime: 3 },
  { tag: 'B', name: 'Banking', serviceTime: 5 },
  { tag: 'C', name: 'Shipping', serviceTime: 10 },
]

const ticketA001 = () => ({
  id: 1,
  code: 'A001',
  serviceType: 'A',
  issuedAt: '2026-10-10T09:00:00.000Z',
  status: 'waiting',
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('listServices', () => {
  // Returns the store services unchanged, in seed order.
  it('returns the services from the store', async () => {
    getServices.mockResolvedValue(seedServices())
    expect(await listServices()).toEqual(seedServices())
    expect(getServices).toHaveBeenCalledTimes(1)
  })

  // An office with no services is a valid, empty list.
  it('returns an empty list when there are no services', async () => {
    getServices.mockResolvedValue([])
    expect(await listServices()).toEqual([])
  })

  // A store failure reaches the caller (and becomes a 500), it is not hidden.
  it('propagates store errors', async () => {
    const storeError = new Error('DB down')
    getServices.mockRejectedValue(storeError)
    await expect(listServices()).rejects.toBe(storeError)
  })
})

describe('createTicket', () => {
  // Asks the store for a ticket of the requested service and returns it.
  it('adds a ticket for the service type and returns it', async () => {
    addTicket.mockResolvedValue(ticketA001())
    expect(await createTicket('A')).toEqual(ticketA001())
    expect(addTicket).toHaveBeenCalledTimes(1)
    expect(addTicket).toHaveBeenCalledWith(expect.objectContaining({ serviceType: 'A' }))
  })

  // The tag is passed exactly as given: no trimming or upper-casing.
  it('does not normalize the service tag', async () => {
    addTicket.mockResolvedValue({ ...ticketA001(), serviceType: 'a' })
    await createTicket('a')
    expect(addTicket).toHaveBeenCalledWith(expect.objectContaining({ serviceType: 'a' }))
  })

  // Unknown service: the store error reaches the route unchanged (-> 404).
  it('propagates ServiceNotFoundError for an unknown service', async () => {
    addTicket.mockRejectedValue(new ServiceNotFoundError('Z'))
    const error = await createTicket('Z').catch((err) => err)
    expect(error).toBeInstanceOf(ServiceNotFoundError)
    expect(error.tag).toBe('Z')
  })

  // Any other store failure is propagated too (-> 500).
  it('propagates other store errors', async () => {
    const storeError = new Error('SQLITE_BUSY')
    addTicket.mockRejectedValue(storeError)
    await expect(createTicket('A')).rejects.toBe(storeError)
  })
})

describe('resetAll', () => {
  // Delegates the full reset to the store and resolves with nothing.
  it('resets the store', async () => {
    reset.mockResolvedValue(undefined)
    await expect(resetAll()).resolves.toBeUndefined()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  // A failed reset must not look successful.
  it('propagates store errors', async () => {
    reset.mockRejectedValue(new Error('locked'))
    await expect(resetAll()).rejects.toThrow('locked')
  })
})
