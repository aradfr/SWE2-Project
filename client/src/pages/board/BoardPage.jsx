import { useEffect, useState } from 'react'
import { Alert, Card, Col, Row, Spinner } from 'react-bootstrap'
import PageLayout from '../../components/PageLayout.jsx'
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
    <PageLayout title="Display board" subtitle="Now serving by service type">
      {error && board && <Alert variant="warning" role="alert">{error}</Alert>}

      {!board ? (
        error ? (
          <Alert variant="danger" role="alert">{error}</Alert>
        ) : (
          <div className="customer-feedback" role="status">
            <Spinner animation="border" variant="primary" />
            <span>Loading board…</span>
          </div>
        )
      ) : (
        <section className="d-grid gap-3" aria-label="Services">
          {Object.entries(board).map(([tag, service]) => (
            <Card as="article" key={tag} className="board-service shadow-sm">
              <Card.Body className="p-4">
                <Row className="align-items-center g-3">
                  <Col md={3}>
                    <span className="customer-service-tag">{tag}</span>
                    <h2 className="customer-service-name h4 mb-0">{service.name}</h2>
                  </Col>

                  <Col md={6}>
                    {service.lastCalledTickets.length ? (
                      <div className="d-flex flex-wrap gap-4">
                        {service.lastCalledTickets.map((call) => (
                          <div key={`${tag}-${call.counterId}`} className="board-call">
                            <span className="text-uppercase small fw-semibold text-secondary">Counter {call.counterId}</span>
                            <strong className="board-call-code">{call.code}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-secondary fs-5 mb-0">No ticket called yet</p>
                    )}
                  </Col>

                  <Col md={3} className="text-md-end">
                    <span className="text-uppercase small fw-semibold text-secondary d-block">Waiting</span>
                    <strong className="board-queue-length">{service.queueLength}</strong>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          ))}
        </section>
      )}
    </PageLayout>
  )
}

export default BoardPage
