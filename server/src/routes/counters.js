/* POST /api/counters/:id/next.
An officer calls the next customer to their counter */

import { Router } from 'express'
import { callNextCustomer, CounterNotFoundError } from '../services/nextCustomerService.js'

const router = Router()

router.post('/:id/next', async (req, res) => {
  // Counter ids are positive integers.
  // E.g., 'abc', '0', '1.5' are rejected.
  const counterId = Number(req.params.id)
  if (!Number.isInteger(counterId) || counterId <= 0) {
    return res.status(400).json({ error: 'counter id must be a positive integer' })
  }

  try {
    const ticket = await callNextCustomer(counterId)
    if (ticket === null) return res.status(204).end() // nobody is waiting
    return res.json(ticket)
  } catch (error) {
    if (error instanceof CounterNotFoundError) {
      return res.status(404).json({ error: error.message })
    }
    throw error // handled by the default error handler
  }
})

export default router
