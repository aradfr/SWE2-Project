// GET /api/board - get the current state of the board (latest called tickets and queue lengths).

import { Router } from 'express'
import { subscribeToBoardEvents } from '../events.js'
import { getBoardState } from '../services/boardService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await getBoardState())
})

router.get('/events', async (req, res) => {
  let ready = false
  let pendingEvents = 0
  let updates = Promise.resolve()
  let heartbeat
  const refreshBoard = () => {
    updates = updates.then(async () => {
      if (res.writableEnded || res.destroyed) return
      writeBoardEvent(res, 'board-state', await getBoardState())
    }).catch((error) => {
      cleanup()
      console.error(error)
      if (!res.destroyed) res.end()
    })
  }

  // Subscribe before loading the snapshot so events during the read are buffered.
  const unsubscribe = subscribeToBoardEvents(() => {
    if (!ready) {
      pendingEvents += 1
      return
    }
    refreshBoard()
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

    // Refresh snapshots for events received while the initial state was loading.
    while (pendingEvents > 0) {
      pendingEvents -= 1
      refreshBoard()
    }
    heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keep-alive\n\n')
    }, 20000)
  } catch (error) {
    cleanup()
    if (!res.headersSent) throw error  
    console.error(error)  
    res.end()  
  }
})

function writeBoardEvent(res, eventName, data) {
  if (!res.writableEnded && !res.destroyed) {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

export default router
