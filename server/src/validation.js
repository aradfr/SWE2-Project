// Request body validation for the HTTP layer.
// Services trust their arguments; routes validate first, so a malformed
// request gets 400 instead of reaching the business logic.

// Thrown when a request body does not match the OpenAPI schema (-> 400).
export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validates the body of POST /api/tickets (NewTicket schema in docs/openapi.yaml).
 * Only the shape is checked here: whether the service exists is decided by the
 * ticket service (unknown service -> 404, not 400).
 * @param {*} body - req.body; undefined when the request has no JSON body (Express 5).
 * @returns {string} The service tag to use.
 * @throws {ValidationError} If the body or serviceType is missing or not a non-empty string.
 */
export function validateNewTicket(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('request body must be a JSON object')
  }
  const { serviceType } = body
  if (serviceType === undefined) {
    throw new ValidationError('serviceType is required')
  }
  if (typeof serviceType !== 'string' || serviceType.trim() === '') {
    throw new ValidationError('serviceType must be a non-empty string')
  }
  return serviceType
}
