import express from 'express'
import boardRouter from './routes/board.js'
import servicesRouter from './routes/services.js'
import ticketsRouter from './routes/tickets.js'
import testRouter from './routes/test.js'
import { errorHandler } from './middleware/errorHandler.js'
import { apiNotFound } from './middleware/notFound.js'

const app = express()
app.use(express.json())

// Health check: used to verify that the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/board', boardRouter)
app.use('/api/services', servicesRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/test', testRouter)

// Any other /api request: JSON 404 instead of Express's HTML page
app.use('/api', apiNotFound)

// Last: turns thrown errors into { error } responses
app.use(errorHandler)

export default app
