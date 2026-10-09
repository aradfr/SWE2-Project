import express from 'express'
import servicesRouter from './routes/services.js'
import ticketsRouter from './routes/tickets.js'
import testRouter from './routes/test.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()
app.use(express.json())

// Health check: used to verify that the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/services', servicesRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/test', testRouter)

// Last: turns thrown errors into { error } responses
app.use(errorHandler)

export default app
