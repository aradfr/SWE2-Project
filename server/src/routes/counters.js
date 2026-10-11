/* Counters API.
GET  /api/counters          list of counters and their services
POST /api/counters/:id/next an officer calls the next customer to their counter
GET  /api/counters/:id/current the ticket the counter is serving (e.g. after a page reload) */

import { Router } from 'express'
import { listCounters } from '../services/counterService.js'
import { callNextCustomer, getCurrentCustomer, CounterNotFoundError } from '../services/nextCustomerService.js'
import { publishBoardEvent, BOARD_EVENTS } from '../events.js'

const router = Router()

// Only digits, no leading zero: '2' is valid.
// E.g., 'abc', '0', '-1', '1.5', '2.0', '1e0', '0x2', '02' are rejected.
const COUNTER_ID = /^[1-9]\d*$/

router.get('/', async (req, res) => {
  const counters = await listCounters()
  res.json({ counters })
})

router.post('/:id/next', async (req, res) => {
  if (!COUNTER_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'counter id must be a positive integer' })
  }
  const counterId = Number(req.params.id)

  try {
    const ticket = await callNextCustomer(counterId)
    if (ticket === null) return res.status(204).end() // nobody is waiting
    publishBoardEvent(BOARD_EVENTS.TICKET_CALLED, ticket)
    return res.json(ticket)
  } catch (error) {
    if (error instanceof CounterNotFoundError) {
      return res.status(404).json({ error: error.message })
    }
    throw error // handled by the error handler
  }
})

router.get('/:id/current', async (req, res) => {
  if (!COUNTER_ID.test(req.params.id)) {
    return res.status(400).json({ error: 'counter id must be a positive integer' })
  }
  const counterId = Number(req.params.id)

  try {
    const ticket = await getCurrentCustomer(counterId)
    if (ticket === null) return res.status(204).end() // no ticket in progress
    return res.json(ticket)
  } catch (error) {
    if (error instanceof CounterNotFoundError) {
      return res.status(404).json({ error: error.message })
    }
    throw error // handled by the error handler
  }
})

// Error handler for the counters routes.
router.use((error, req, res, next) => {
  if (res.headersSent) return next(error)
  console.error(error)
  res.status(500).json({ error: 'internal server error' })
})

export default router
