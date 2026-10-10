import { EventEmitter } from 'node:events'

export const BOARD_EVENTS = Object.freeze({
  TICKET_ISSUED: 'ticket-issued',
  TICKET_CALLED: 'ticket-called',
})

const boardEvents = new EventEmitter()

export function publishBoardEvent(eventName, data) {
  boardEvents.emit('board-change', eventName, data)
}

export function subscribeToBoardEvents(listener) {
  boardEvents.on('board-change', listener)
  return () => boardEvents.off('board-change', listener)
}
