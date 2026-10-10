// Maps errors to the Error schema of docs/openapi.yaml: { error: message }.
// Must be registered after all routes (Express recognizes error handlers
// by their four arguments).

import { ValidationError } from '../validation.js'
import { ServiceNotFoundError } from '../services/ticketService.js'

// eslint-disable-next-line no-unused-vars -- `next` is required by Express
export function errorHandler(err, req, res, next) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message })
  }
  if (err instanceof ServiceNotFoundError) {
    return res.status(404).json({ error: err.message })
  }
  // Malformed JSON body, rejected by express.json() before reaching a route
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid JSON body' })
  }
  // Unexpected: log it, but never leak internals to the client
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
}
