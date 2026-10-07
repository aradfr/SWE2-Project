import express from 'express'

const app = express()
app.use(express.json())

// Health check: used to verify that the server is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

export default app
