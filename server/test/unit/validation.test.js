import { describe, it, expect } from 'vitest'
import { validateNewTicket, ValidationError } from '../../src/validation.js'

describe('validateNewTicket', () => {
  // A well-formed body returns the service tag to use.
  it('returns serviceType for a valid body', () => {
    expect(validateNewTicket({ serviceType: 'A' })).toBe('A')
  })

  // Extra fields are ignored: only serviceType matters for the NewTicket schema.
  it('ignores extra fields', () => {
    expect(validateNewTicket({ serviceType: 'B', note: 'hello' })).toBe('B')
  })

  // The tag is passed through unchanged: an unknown tag is a 404 decided later, not a 400.
  it('does not check whether the service exists', () => {
    expect(validateNewTicket({ serviceType: 'Z' })).toBe('Z')
  })

  // Express 5 leaves req.body undefined when the request has no JSON body.
  it.each([
    ['undefined (no body)', undefined],
    ['null', null],
    ['an array', ['A']],
    ['a string', 'A'],
    ['a number', 42],
  ])('rejects a body that is %s', (_label, body) => {
    expect(() => validateNewTicket(body)).toThrow(ValidationError)
    expect(() => validateNewTicket(body)).toThrow('request body must be a JSON object')
  })

  // Missing serviceType has its own message, matching the openapi Error example.
  it('rejects a body without serviceType', () => {
    expect(() => validateNewTicket({})).toThrow('serviceType is required')
  })

  // Wrong types and blank strings are malformed requests (400), not unknown services (404).
  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
    ['an object', { tag: 'A' }],
    ['an empty string', ''],
    ['a blank string', '   '],
  ])('rejects serviceType that is %s', (_label, serviceType) => {
    expect(() => validateNewTicket({ serviceType })).toThrow(ValidationError)
    expect(() => validateNewTicket({ serviceType })).toThrow('serviceType must be a non-empty string')
  })

  // The error class is recognizable by the error handler.
  it('throws an error named ValidationError', () => {
    const error = (() => {
      try {
        validateNewTicket({})
      } catch (err) {
        return err
      }
    })()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ValidationError')
  })
})
