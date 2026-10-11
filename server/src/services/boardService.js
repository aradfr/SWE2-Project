import { getBoardData } from '../store.js'

/**
 * Last-called ticket details returned for one counter and service type.
 * @typedef {object} LastCalledTicket
 * @property {number} counterId - Counter that called the ticket.
 * @property {string} code - Code of the last called ticket.
 * @property {string} calledAt - Call time.
 */

/**
 * State for one service type on the board.
 * @typedef {object} BoardServiceState
 * @property {string} name - Display name of the service type.
 * @property {number} queueLength - Number of waiting tickets.
 * @property {LastCalledTicket[]} lastCalledTickets - Latest call at each counter.
 */

/**
 * Current state shown on the board, keyed by service tag.
 * @typedef {Record<string, BoardServiceState>} BoardState
 */

/**
 * Load the board state grouped by service tag.
 * @returns {Promise<BoardState>}
 */
export async function getBoardState() {
  return getBoardData()
}
