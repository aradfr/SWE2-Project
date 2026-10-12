import { Container } from 'react-bootstrap'

/**
 * Common structure of every page (except the full-screen board):
 * a header row with title and subtitle on the left and actions on the right,
 * followed by the page content.
 * @param {object} props
 * @param {string} props.title - Page title (required).
 * @param {string} [props.subtitle] - Short text under the title.
 * @param {import('react').ReactNode} [props.actions] - Elements shown right of the title (e.g. buttons).
 * @param {import('react').ReactNode} props.children - Page content.
 */
function PageLayout({ title, subtitle, actions, children }) {
  return (
    <Container className="py-4">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
        <div>
          <h1 className="h2 mb-1">{title}</h1>
          {subtitle && <p className="text-secondary mb-0">{subtitle}</p>}
        </div>
        {actions && <div className="d-flex gap-2">{actions}</div>}
      </div>
      {children}
    </Container>
  )
}

export default PageLayout
