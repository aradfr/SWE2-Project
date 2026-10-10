// POST /api/tickets - "Get ticket" story: issue a ticket for a service type.
// Errors are not handled here: Express 5 forwards rejected promises to the
// error handler, which maps them to status codes.

import { Router } from 'express'
import { validateNewTicket } from '../validation.js'
import { createTicket } from '../services/ticketService.js'

const router = Router()

router.post('/', async (req, res) => {
  const serviceType = validateNewTicket(req.body) // 400 if malformed
  const ticket = await createTicket(serviceType) // 404 if unknown service
  res.status(201).json(ticket)
})

export default router
