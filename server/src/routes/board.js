// Board snapshot and live updates.

import { Router } from 'express'
import { subscribeToBoardEvents } from '../events.js'
import { getBoardState } from '../services/boardService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await getBoardState())
})

router.get('/events', async (req, res) => {
  let ready = false
  const pendingEvents = []
  let heartbeat
  const unsubscribe = subscribeToBoardEvents((eventName, data) => {
    if (!ready) {
      pendingEvents.push({ eventName, data })
      return
    }
    writeBoardEvent(res, eventName, data)
  })

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat)
    unsubscribe()
  }
  res.once('close', cleanup)

  try {
    const boardState = await getBoardState()
    if (res.destroyed) return

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()
    writeBoardEvent(res, 'board-state', boardState)
    ready = true

    for (const { eventName, data } of pendingEvents) {
      writeBoardEvent(res, eventName, data)
    }
    heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keep-alive\n\n')
    }, 20000)
  } catch (error) {
    cleanup()
    throw error
  }
})

function writeBoardEvent(res, eventName, data) {
  if (!res.writableEnded && !res.destroyed) {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

export default router
