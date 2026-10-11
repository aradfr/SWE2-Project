import { EventEmitter } from 'node:events'

export const BOARD_EVENTS = Object.freeze({
  TICKET_ISSUED: 'ticket-issued',
  TICKET_CALLED: 'ticket-called',
})

const boardEvents = new EventEmitter()

// Routes publish domain changes here; every connected board stream receives them.
// A failing listener is logged and skipped: the route that published still answers.
export function publishBoardEvent(eventName, data) {
  for (const listener of boardEvents.listeners('board-change')) {
    try {
      listener(eventName, data)
    } catch (error) {
      console.error(error)
    }
  }
}

// Return a disposer so an SSE connection can stop listening when it closes.
export function subscribeToBoardEvents(listener) {
  boardEvents.on('board-change', listener)
  return () => boardEvents.off('board-change', listener)
}
