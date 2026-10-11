import { describe, it, expect, vi, afterEach } from 'vitest'
import { errorHandler } from '../../src/middleware/errorHandler.js'
import { apiNotFound } from '../../src/middleware/notFound.js'
import { ValidationError } from '../../src/validation.js'
import { ServiceNotFoundError } from '../../src/services/ticketService.js'

// Minimal fake of an Express response: records status and JSON body.
function fakeRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('errorHandler', () => {
  // Malformed request body -> 400 with the validation message.
  it('maps ValidationError to 400', () => {
    const res = fakeRes()
    errorHandler(new ValidationError('serviceType is required'), {}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'serviceType is required' })
  })

  // Unknown service tag -> 404 with the store message.
  it('maps ServiceNotFoundError to 404', () => {
    const res = fakeRes()
    errorHandler(new ServiceNotFoundError('Z'), {}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown service type: Z' })
  })

  // express.json() rejects invalid JSON with type 'entity.parse.failed' -> 400.
  it('maps a JSON parse error to 400', () => {
    const res = fakeRes()
    const parseError = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' })
    errorHandler(parseError, {}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid JSON body' })
  })

  // Anything else -> 500, logged on the server, with no internal details sent to the client.
  it('maps unexpected errors to 500 without leaking the message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    const boom = new Error('SQLITE_BUSY: database is locked')
    errorHandler(boom, {}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'internal server error' })
    expect(log).toHaveBeenCalledWith(boom)
  })

  // The handler answers itself: it never passes the error on.
  it('does not call next', () => {
    const next = vi.fn()
    errorHandler(new ValidationError('x'), {}, fakeRes(), next)
    expect(next).not.toHaveBeenCalled()
  })

  // Express recognizes error handlers only by their 4 parameters.
  it('declares four parameters', () => {
    expect(errorHandler.length).toBe(4)
  })
})

describe('apiNotFound', () => {
  // Unknown /api route -> JSON 404 naming the method and the full path.
  it('answers 404 with method and original URL', () => {
    const res = fakeRes()
    apiNotFound({ method: 'DELETE', originalUrl: '/api/tickets' }, res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found: DELETE /api/tickets' })
  })

  // The query string is part of originalUrl and is reported as sent.
  it('keeps the query string in the message', () => {
    const res = fakeRes()
    apiNotFound({ method: 'GET', originalUrl: '/api/nope?x=1' }, res)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found: GET /api/nope?x=1' })
  })
})
