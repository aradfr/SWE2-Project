import { useEffect, useState } from 'react'
import { getBoard, subscribeToBoardEvents } from '../../api/client.js'

const REFRESH_INTERVAL = 5000

function BoardPage() {
  const [board, setBoard] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let latestRequest = 0

    const refreshBoard = async () => {
      const requestId = ++latestRequest
      try {
        const boardResponse = await getBoard()
        if (!active || requestId !== latestRequest) return
        setBoard(boardResponse)
        setError('')
      } catch (requestError) {
        if (!active || requestId !== latestRequest) return
        setError(requestError.message || 'Could not load the board.')
      }
    }

    const unsubscribe = subscribeToBoardEvents((eventName, data) => {
      if (eventName === 'board-state') {
        setBoard(data)
        setError('')
      } else {
        refreshBoard()
      }
    }, (eventError) => {
      if (active) setError(eventError.message)
    })

    refreshBoard()
    const intervalId = setInterval(refreshBoard, REFRESH_INTERVAL)

    return () => {
      active = false
      clearInterval(intervalId)
      unsubscribe()
    }
  }, [])

  return (
    <main className="board-screen">
      <header className="board-header">
        <div>
          <h1 className="board-title">Office queue</h1>
          <p className="board-subtitle">Now serving by service type</p>
        </div>
      </header>

      {error && board && <p className="board-message error" role="alert">{error}</p>}

      {!board ? (
        <p className={`board-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
          {error || 'Loading board…'}
        </p>
      ) : (
        <section className="board-services" aria-label="Services">
          {Object.entries(board).map(([tag, service]) => (
            <article key={tag} className="board-service">
              <div className="board-service-name">
                <span className="board-service-tag">{tag}</span>
                <div>
                  <h2>{service.name}</h2>
                  <small>Service</small>
                </div>
              </div>

              <div className="board-calls">
                {service.lastCalledTickets.length ? (
                  service.lastCalledTickets.map((call) => (
                    <div key={`${tag}-${call.counterId}`} className="board-call">
                      <span>Counter {call.counterId}</span>
                      <strong>{call.code}</strong>
                    </div>
                  ))
                ) : (
                  <p>No ticket called yet</p>
                )}
              </div>

              <div className="board-queue">
                <span>Waiting queue</span>
                <strong>{service.queueLength}</strong>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

export default BoardPage
