import express from 'express'
import countersRouter from './routes/counters.js'

const app = express()
app.use(express.json())

// Health check: used to verify that the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/counters', countersRouter)

export default app
