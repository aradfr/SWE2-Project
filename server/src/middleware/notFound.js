// Catch-all for /api requests that no route handled (unknown path or method).
// Without it Express answers with an HTML page; this keeps every API
// response in the { error } shape of docs/openapi.yaml.
// Must be registered after all API routes and before the error handler.

export function apiNotFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` })
}
