/* Unit tests of events.js: the in-process channel between the routes that
change the queues and the open board streams. */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { BOARD_EVENTS, publishBoardEvent, subscribeToBoardEvents } from '../../src/events.js'

const unsubscribers = []
function subscribe(listener) {
  const unsubscribe = subscribeToBoardEvents(listener)
  unsubscribers.push(unsubscribe)
  return unsubscribe
}

afterEach(() => {
  // The emitter is shared by the whole module: never leave listeners behind.
  while (unsubscribers.length) unsubscribers.pop()()
  vi.restoreAllMocks()
})

describe('BOARD_EVENTS', () => {
  it('names the two changes the board reacts to', () => {
    expect(BOARD_EVENTS).toEqual({ TICKET_ISSUED: 'ticket-issued', TICKET_CALLED: 'ticket-called' })
  })

  it('cannot be changed', () => {
    expect(Object.isFrozen(BOARD_EVENTS)).toBe(true)
  })
})

describe('publishBoardEvent / subscribeToBoardEvents', () => {
  it('passes the event name and data to the listener', () => {
    const listener = vi.fn()
    subscribe(listener)
    const ticket = { code: 'A001', counterId: 1 }

    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, ticket)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith('ticket-called', ticket)
  })

  it('notifies every listener, in subscription order', () => {
    const calls = []
    subscribe(() => calls.push('first'))
    subscribe(() => calls.push('second'))

    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})

    expect(calls).toEqual(['first', 'second'])
  })

  it('does nothing when nobody is listening', () => {
    expect(() => publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})).not.toThrow()
  })

  it('stops notifying a listener after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    unsubscribe()
    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes only the listener that unsubscribes', () => {
    const kept = vi.fn()
    const removed = vi.fn()
    subscribe(kept)
    const unsubscribe = subscribe(removed)

    unsubscribe()
    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, {})

    expect(kept).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
  })

  it('can be unsubscribed twice without errors', () => {
    const unsubscribe = subscribe(vi.fn())
    unsubscribe()
    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('a failing listener', () => {
  it('does not throw to the publisher', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    subscribe(() => { throw new Error('board stream broken') })

    expect(() => publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, {})).not.toThrow()
  })

  it('does not stop the next listeners', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const next = vi.fn()
    subscribe(() => { throw new Error('board stream broken') })
    subscribe(next)

    publishBoardEvent(BOARD_EVENTS.TICKET_ISSUED, { code: 'A001' })

    expect(next).toHaveBeenCalledWith('ticket-issued', { code: 'A001' })
  })

  it('is logged', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('board stream broken')
    subscribe(() => { throw error })

    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, {})

    expect(log).toHaveBeenCalledWith(error)
  })
})
