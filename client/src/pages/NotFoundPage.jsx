import { Button } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import PageLayout from '../components/PageLayout.jsx'

// Shown for any address that does not match a route.
function NotFoundPage() {
  return (
    <PageLayout title="Page not found">
      <Button as={Link} to="/" variant="primary">Back to home</Button>
    </PageLayout>
  )
}

export default NotFoundPage
