import express from 'express'
import servicesRouter from './routes/services.js'
import ticketsRouter from './routes/tickets.js'
import countersRouter from './routes/counters.js'
import testRouter from './routes/test.js'
import { errorHandler } from './middleware/errorHandler.js'
import { apiNotFound } from './middleware/notFound.js'

const app = express()
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/services', servicesRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/counters', countersRouter)
app.use('/api/test', testRouter)

// Any other /api request: JSON 404 instead of Express's HTML page
app.use('/api', apiNotFound)

// Last: turns thrown errors into { error } responses
app.use(errorHandler)

export default app