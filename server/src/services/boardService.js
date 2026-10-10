import { getLastCalledTickets, getQueueLengths } from '../store.js'

/**
 * Last-called ticket details returned for one counter and service type.
 * @typedef {object} LastCalledTicket
 * @property {number} counterId - Counter that called the ticket.
 * @property {string} name - Display name of the service type.
 * @property {string} code - Code of the last called ticket.
 * @property {string} calledAt - Call time.
 */

/**
 * Current state shown on the board.
 * @typedef {object} BoardState
 * @property {Record<string, LastCalledTicket[]>} board - Latest call per counter, grouped by service tag.
 * @property {Record<string, number>} queueLengths - Waiting ticket count by service tag.
 */

/**
 * Load the latest calls and queue lengths for the board's initial state and updates.
 * @returns {Promise<BoardState>}
 */
export async function getBoardState() {
  const [board, queueLengths] = await Promise.all([
    getLastCalledTickets(),
    getQueueLengths(),
  ])
  return { board, queueLengths }
}
