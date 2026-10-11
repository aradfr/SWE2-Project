import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import PageLayout from '../../components/PageLayout.jsx'
import { createTicket, getServices } from '../../api/client.js'

function CustomerPage() {
  // The page has one state for each step of the customer ticket flow.
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedServiceTag, setSelectedServiceTag] = useState('')
  const [ticketState, setTicketState] = useState({ status: 'idle' })
  const [submitting, setSubmitting] = useState(false)

  async function loadServices() {
    setLoading(true)
    setError('')
    try {
      setServices(await getServices())
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  // Ignore late responses if the page is left while the request is pending.
  useEffect(() => {
    let active = true
    getServices()
      .then((loadedServices) => {
        if (active) setServices(loadedServices)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Keep the receipt visible briefly, then make the kiosk ready for the next customer.
  useEffect(() => {
    if (ticketState.status !== 'issued') return undefined
    const timeoutId = window.setTimeout(() => {
      setTicketState({ status: 'idle' })
      setSelectedServiceTag('')
    }, 5000)
    return () => window.clearTimeout(timeoutId)
  }, [ticketState])

  // Disable all service buttons while the ticket request is in flight.
  async function handleServiceSelection(service) {
    if (submitting) return
    setSelectedServiceTag(service.tag)
    setSubmitting(true)
    setError('')
    try {
      const issuedTicket = await createTicket(service.tag)
      setTicketState({ status: 'issued', ticket: issuedTicket })
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  function handleDone() {
    setTicketState({ status: 'idle' })
    setSelectedServiceTag('')
  }

  // The receipt is a separate view so the issued code is immediately prominent.
  if (ticketState.status === 'issued') {
    const { ticket } = ticketState
    const selectedService = services.find((service) => service.tag === selectedServiceTag)

    return (
      <PageLayout title="Ticket issued" subtitle="Please keep this code and wait for your turn.">
        <Card className="ticket-card mx-auto shadow-sm">
          <Card.Body className="text-center p-4 p-md-5">
            <p className="text-uppercase small fw-semibold text-secondary mb-2">Your ticket</p>
            <p className="ticket-code mb-3">{ticket.code}</p>
            <p className="mb-4">Service: <strong>{selectedService?.name || ticket.serviceType}</strong></p>
            <p className="text-secondary small mb-4">This screen will reset in 5 seconds.</p>
            <Button type="button" variant="primary" onClick={handleDone}>Done</Button>
          </Card.Body>
        </Card>
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Customer" subtitle="Touch the service you need to take a ticket.">
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="customer-feedback" role="status">
          <Spinner animation="border" variant="primary" />
          <span>Loading services...</span>
        </div>
      ) : services.length === 0 ? (
        <div className="customer-feedback">
          <p className="mb-3">No services are currently available.</p>
          <Button type="button" variant="outline-primary" onClick={loadServices}>Try again</Button>
        </div>
      ) : (
        <Row xs={1} sm={2} lg={3} className="g-4 customer-service-grid">
          {services.map((service) => (
            <Col key={service.tag}>
              <Button
                type="button"
                variant="light"
                className="customer-service-button w-100 h-100 text-start"
                disabled={submitting}
                onClick={() => handleServiceSelection(service)}
              >
                <span className="customer-service-tag">{service.tag}</span>
                <span className="customer-service-name">{service.name}</span>
                <span className="customer-service-time">Average service time: {service.serviceTime} min</span>
                {submitting && selectedServiceTag === service.tag && (
                  <Spinner className="customer-service-spinner" animation="border" size="sm" aria-label="Issuing ticket" />
                )}
              </Button>
            </Col>
          ))}
        </Row>
      )}
    </PageLayout>
  )
}

export default CustomerPage
