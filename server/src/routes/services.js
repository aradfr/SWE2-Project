// GET /api/services - list the service types a customer can choose from.

import { Router } from 'express'
import { listServices } from '../services/serviceTypeService.js'

const router = Router()

router.get('/', async (req, res) => {
  const services = await listServices()
  res.json({ services })
})

export default router
