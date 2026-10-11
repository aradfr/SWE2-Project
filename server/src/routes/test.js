// POST /api/test/reset - test-only hook to clear queues and counters.
// NODE_ENV is read on every request, so the check cannot be bypassed by
// the order in which modules are loaded.

import { Router } from 'express'
import { resetAll } from '../services/resetService.js'

const router = Router()

router.post('/reset', async (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(403).json({ error: 'reset is only available in test mode' })
  }
  await resetAll()
  res.status(204).end()
})

export default router
