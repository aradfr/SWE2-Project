import { Button, Card, Col, Row } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import PageLayout from '../components/PageLayout.jsx'

// One card per role. Texts are used by the E2E tests: keep them unchanged.
const ROLES = [
  { title: 'Customer', description: 'Take a ticket for a service', to: '/customer' },
  { title: 'Officer', description: 'Call the next customer at your counter', to: '/officer' },
  { title: 'Display board', description: 'See who is called and the queues', to: '/board' },
]

// Home page: no login, the user chooses a role.
function HomePage() {
  return (
    <PageLayout title="Office Queue Management" subtitle="Choose how you want to use the system">
      <Row xs={1} md={3} className="g-4">
        {ROLES.map((role) => (
          <Col key={role.to}>
            <Card className="h-100 shadow-sm role-card">
              <Card.Body className="d-flex flex-column">
                <Card.Title as="h2" className="h4">{role.title}</Card.Title>
                <Card.Text className="flex-grow-1">{role.description}</Card.Text>
                <Button as={Link} to={role.to} variant="primary" className="align-self-start">
                  Continue
                </Button>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </PageLayout>
  )
}

export default HomePage
