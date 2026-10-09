import { Container, Nav, Navbar } from 'react-bootstrap'
import { Link, NavLink } from 'react-router-dom'

// Top navigation bar, shown on every page except the full-screen board.
// NavLink adds the "active" class to the link of the current page.
function AppNavbar() {
  return (
    <Navbar className="app-navbar" variant="dark" expand="md">
      <Container>
        <Navbar.Brand as={Link} to="/">Office Queue Management</Navbar.Brand>
        <Navbar.Toggle aria-controls="app-navbar-links" />
        <Navbar.Collapse id="app-navbar-links">
          <Nav className="ms-auto">
            <Nav.Link as={NavLink} to="/customer">Customer</Nav.Link>
            <Nav.Link as={NavLink} to="/officer">Officer</Nav.Link>
            <Nav.Link as={NavLink} to="/board">Display board</Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  )
}

export default AppNavbar
