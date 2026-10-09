# Office Queue Management System

Software Engineering 2 team project (PoliTO, a.y. 2026/27).
Manages queues for desk services open to the public (post office, medical office):
customers take a ticket for a service type, officers call the next customer,
a display board shows queue lengths, managers see statistics.

## Repository layout

```
server/   Express REST API (ES modules)
client/   React + Vite frontend
docs/     openapi.yaml - the API contract
```

## Server structure

```
server/src/routes/        Express routes (HTTP only: validation, status codes)
server/src/services/      business logic of each story (no HTTP)
server/src/store.js       single in-memory data access point (queue.js, seed.js used only by the store)
server/test/unit/         unit tests
server/test/integration/  HTTP integration tests
```

Routes call services, services call the store; routes never use the store directly.
Services and routes use `async`/`await`: the store is synchronous today, but it
will become async when the database arrives, with the same function names.

## Tech decisions (Sprint 1)

- **Node 22 + Express** backend, **React + Vite** frontend, one language everywhere.
- **In-memory storage**: the spec resets all queues every morning and has no
  persistence requirement, so no DB in sprint 1. The storage layer is isolated
  in `server/src/store.js` so a real DB can replace it without touching routes.
- **API-first**: `docs/openapi.yaml` is the contract. Frontend and backend work
  happen in parallel against it.
- **Testing**: Vitest everywhere, Supertest for HTTP integration tests,
  React Testing Library for the client, Playwright for E2E (not set up yet).

## Quick start

```bash
npm install                 # installs server + client (npm workspaces)
npm run dev:server          # API on http://localhost:3001
npm run dev:client          # UI on http://localhost:5173 (proxies /api to 3001)
```

## Tests

```bash
npm test                    # server + client unit/integration tests
```

E2E tests (Playwright) are not set up yet: `npm run test:e2e` will fail until they are.

## API (Sprint 1)

| Method | Path               | Success        | Errors                                       |
| ------ | ------------------ | -------------- | -------------------------------------------- |
| GET    | `/api/health`      | 200 `{status}` |                                              |
| GET    | `/api/services`    | 200 `{services}` |                                            |
| POST   | `/api/tickets`     | 201 ticket     | 400 invalid body, 404 unknown service type   |
| POST   | `/api/test/reset`  | 204            | 403 unless `NODE_ENV=test`                   |

All errors use the body `{ "error": "message" }`. Any other `/api` path or
method returns 404 with the same body. Full contract: `docs/openapi.yaml`.

## Git workflow

- `main`: reviewed, demo-ready code only. Default branch.
- `dev`: integration branch for the sprint. Open PRs to `main`.
- Definition of Done: unit tested, integration + E2E tested, code reviewed, pushed here.

## Ticket codes

Service tag + 3-digit number per service (`A001`, `A002`, ..., `B001`, ...).
Numbers restart from `001` every morning, when the queues are reset.

Assumption: after `999` a service's numbering restarts from `001`, so codes are
unique within the day unless a service exceeds 999 tickets. The ticket `id` is
always unique.
