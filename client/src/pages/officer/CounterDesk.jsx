import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import PageLayout from '../../components/PageLayout.jsx'
import { ApiError, callNextCustomer, getCounters, getServices } from '../../api/officer.js'

// Texts and data-testid values are used by the E2E tests: keep them unchanged.

/** Shown for an unknown counter or an invalid counter id: no Next customer button. */
export function CounterNotFound() {
  return (
    <PageLayout title="Officer">
      <Row className="justify-content-center">
        <Col md={8} lg={6}>
          <Alert variant="danger">Counter not found</Alert>
        </Col>
      </Row>
    </PageLayout>
  )
}

/**
 * Desk of one counter: the officer calls the next customer.
 * The device of each counter opens its own page directly (/officer/2),
 * so there is no way to go back or change counter from here.
 * @param {object} props
 * @param {number} props.counterId - A positive integer, already validated.
 */
function CounterDesk({ counterId }) {
  const [serviceNames, setServiceNames] = useState({}) // tag -> name
  const [counterServices, setCounterServices] = useState(null) // tags, null until loaded
  const [notFound, setNotFound] = useState(false)
  const [ticket, setTicket] = useState(null) // last called ticket
  const [calling, setCalling] = useState(false)
  const [message, setMessage] = useState(null) // null | 'empty' | 'error'

  // Counter info only feeds the subtitle: if it cannot be loaded,
  // Next customer stays usable and an unknown counter shows up as a 404.
  useEffect(() => {
    let active = true
    Promise.all([getCounters(), getServices()])
      .then(([counters, services]) => {
        if (!active) return
        const counter = counters.find((item) => item.id === counterId)
        if (!counter) {
          setNotFound(true)
          return
        }
        setServiceNames(Object.fromEntries(services.map((service) => [service.tag, service.name])))
        setCounterServices(counter.services)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [counterId])

  async function handleNextCustomer() {
    setCalling(true)
    try {
      const next = await callNextCustomer(counterId)
      if (next === null) {
        setMessage('empty') // the last ticket stays visible
      } else {
        setTicket(next)
        setMessage(null)
      }
    } catch (error) {
      // Decide on the status only, never on the error text
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        setNotFound(true)
      } else {
        setMessage('error')
      }
    } finally {
      setCalling(false)
    }
  }

  if (notFound) return <CounterNotFound />

  const nameOf = (tag) => serviceNames[tag] ?? tag
  const subtitle = counterServices?.map(nameOf).join(' · ')

  return (
    <PageLayout title={`Counter ${counterId}`} subtitle={subtitle}>
      <Row className="justify-content-center">
        <Col md={8} lg={6}>
          <Card className="text-center shadow-sm mb-4" aria-live="polite">
            <Card.Body>
              <h2 className="h5 text-secondary">Now serving</h2>
              {ticket ? (
                <>
                  <p className="display-1 fw-bold mb-0" data-testid="ticket-code">{ticket.code}</p>
                  <p className="fs-3 mb-0" data-testid="ticket-service">{nameOf(ticket.serviceType)}</p>
                </>
              ) : (
                <p className="fs-3 mb-0">No customer yet</p>
              )}
            </Card.Body>
          </Card>

          <div className="d-grid gap-2">
            <Button variant="primary" size="lg" className="py-3" onClick={handleNextCustomer} disabled={calling}>
              {calling ? (
                <>
                  <Spinner as="span" animation="border" size="sm" aria-hidden="true" className="me-2" />
                  Calling...
                </>
              ) : (
                'Next customer'
              )}
            </Button>
          </div>

          <div className="mt-3" aria-live="polite">
            {message === 'empty' && (
              <Alert variant="warning">
                <span aria-hidden="true">⚠ </span>No customers waiting
              </Alert>
            )}
            {message === 'error' && <Alert variant="danger">Something went wrong. Try again.</Alert>}
          </div>
        </Col>
      </Row>
    </PageLayout>
  )
}

export default CounterDesk
