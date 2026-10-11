// Shared helper for calls to the server API (proxied to :3001 by Vite).
// Each role adds its own functions in api/<role>.js using apiFetch.

/** Error for a server response that is not ok (status 4xx/5xx). */
export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} message - Error message (from the server when available).
   */
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Calls the server API and returns the parsed JSON response.
 * @param {string} path - Path after /api, e.g. '/tickets'.
 * @param {RequestInit & { body?: object | BodyInit }} [options] - fetch options;
 *   an object or array body is sent as JSON.
 * @returns {Promise<any>} The response JSON, or null for 204 No Content.
 * @throws {ApiError} If the server answers with an error status.
 * @throws {Error} If the server cannot be reached (network error).
 */
export async function apiFetch(path, options = {}) {
  const { body, headers, ...rest } = options
  const init = { ...rest, headers: { ...headers } }

  if (isJsonBody(body)) {
    init.body = JSON.stringify(body)
    init.headers['Content-Type'] = 'application/json'
  } else if (body !== undefined) {
    init.body = body
  }

  let response
  try {
    response = await fetch('/api' + path, init)
  } catch (error) {
    throw new Error('Cannot reach the server. Is it running?', { cause: error })
  }

  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response))
  }
  if (response.status === 204) return null
  return response.json()
}

// True for bodies to send as JSON: plain objects ({ ... }) and arrays.
// FormData, Blob, URLSearchParams and strings are passed to fetch unchanged.
function isJsonBody(value) {
  return Array.isArray(value) ||
    (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
}

// Uses the "error" field of the JSON body (see the Error schema in the API
// contract), falling back to the HTTP status text.
async function errorMessage(response) {
  try {
    const data = await response.json()
    if (data && typeof data.error === 'string') return data.error
  } catch {
    // body is not JSON
  }
  return response.statusText || `Request failed with status ${response.status}`
}
