import { useEffect, useState } from 'react'
import { Alert, Button, Card, Col, Row, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import PageLayout from '../../components/PageLayout.jsx'
import { getCounters, getServices } from '../../api/officer.js'

// List of the counters, for development and demos only: each counter device
// opens its own page (/officer/2) directly. Texts are used by the E2E tests.
function CounterSelect() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let active = true
    // Service names are extra information: without them the cards show the tags.
    // Only a failure of getCounters() is an error.
    Promise.all([getCounters(), getServices().catch(() => [])])
      .then(([counters, services]) => {
        if (!active) return
        const names = Object.fromEntries(services.map((service) => [service.tag, service.name]))
        setState({ status: 'ready', counters, names })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <PageLayout title="Officer" subtitle="Select your counter">
      {state.status === 'loading' && (
        <div className="d-flex align-items-center gap-2" role="status">
          <Spinner animation="border" size="sm" aria-hidden="true" />
          Loading counters...
        </div>
      )}

      {state.status === 'error' && (
        <Alert variant="danger">Could not load the counters. Try again later.</Alert>
      )}

      {state.status === 'ready' && (
        <Row xs={1} sm={2} lg={3} className="g-4">
          {state.counters.map((counter) => (
            <Col key={counter.id}>
              <Card className="h-100 shadow-sm">
                <Card.Body className="d-flex flex-column">
                  <Card.Title as="h2" className="h4">Counter {counter.id}</Card.Title>
                  <Card.Text className="flex-grow-1">
                    {counter.services.map((tag) => state.names[tag] ?? tag).join(' · ')}
                  </Card.Text>
                  <Button as={Link} to={`/officer/${counter.id}`} variant="primary" className="align-self-start">
                    Open
                  </Button>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </PageLayout>
  )
}

export default CounterSelect
