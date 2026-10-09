// Placeholder: replaced by task OQM-24.
// Full-screen page: does not use PageLayout. Browser fullscreen (F11 / Fullscreen API) is up to OQM-24.
import { Container } from 'react-bootstrap'
import { Link } from 'react-router-dom'

function BoardPage() {
  return (
    <Container fluid className="board-screen min-vh-100 d-flex flex-column justify-content-center align-items-center position-relative">
      <Link to="/" className="position-absolute top-0 start-0 m-3 small text-white-50">Home</Link>
      <h1 className="display-1 fw-bold">Display board</h1>
      <p className="fs-2">Coming soon</p>
    </Container>
  )
}

export default BoardPage
