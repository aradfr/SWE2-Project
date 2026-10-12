# Office Queue Management System

## Sprint 1 stories

| Story | What it does | UI page |
| ----- | ------------ | ------- |
| Get ticket | A customer chooses a service and gets a ticket code (e.g. `A001`) | `/customer` |
| Next customer | An officer calls the next customer to their counter | `/officer`, `/officer/:counterId` |
| Call customer | The display board shows the last call of each counter and the queue lengths, live | `/board` |

## Quick start

Requirements: Node 22 or 24 (LTS), npm.

```bash
npm install                 # installs server + client (npm workspaces)
npm run dev:server          # API on http://localhost:3001
npm run dev:client          # UI on http://localhost:5173 (proxies /api to 3001)
```

Open http://localhost:5173 and choose a role. To see the whole flow, open
`/customer`, `/officer` and `/board` in three windows.

The database is created at `server/data/office_queue.db` on the first start
(ignored by git).

## Repository layout

```
server/   Express REST API (ES modules) + SQLite
client/   React + Vite frontend
e2e/      Playwright end-to-end tests
docs/     openapi.yaml - the API contract
```

## Server structure

```
server/src/app.js          Express app: routes, JSON 404 for /api, error handler
server/src/index.js        starts the server (PORT, default 3001)
server/src/routes/         HTTP only: validation, status codes
server/src/services/       business logic of each story (no HTTP)
server/src/events.js       in-process events: routes publish, board streams listen
server/src/store.js        data access facade used by the services
server/src/dao/            SQLite: db.js (open, schema, migration), officeDao.js,
                           ticketDao.js, transaction.js, schema.sql
server/src/seed.js         services and counters loaded at startup
server/src/middleware/     errorHandler.js, notFound.js
server/test/unit/          unit tests
server/test/integration/   HTTP integration tests (Supertest, temporary database)
```

Routes call services, services call the store, the store calls the DAOs;
routes never use the store directly.

### Office configuration (seed)

| Service | Tag | Average service time |
| ------- | --- | -------------------- |
| Payments | `A` | 3 min |
| Banking | `B` | 5 min |
| Shipping | `C` | 10 min |

| Counter | Serves |
| ------- | ------ |
| 1 | A |
| 2 | A, B |
| 3 | C |

## Client structure

```
client/src/
  main.jsx, App.jsx   entry point and routes (shared)
  theme.css           team palette (shared)
  components/         shared UI: AppNavbar, PageLayout
  api/client.js       apiFetch (the only way to call the server), board API and SSE
  api/<role>.js       API functions of each role (customer.js, officer.js)
  pages/<role>/       pages of each role: customer/, officer/, board/
```


## Tests

```bash
npm test                         # server + client unit and integration tests (Vitest)
npm run coverage -w server       # server coverage report
npm run lint -w server && npm run lint -w client
npx playwright install chromium  # only the first time: downloads the browser for the E2E tests
npm run test:e2e                 # Playwright E2E tests
```

- **Server**: Vitest, Supertest for HTTP integration tests. Integration tests
  use a temporary SQLite file: the development database is never touched.
- **Client**: Vitest + React Testing Library (jsdom). Client integration tests
  start the real Express app on a free port.
- **E2E**: Playwright (`e2e/`), one spec per story (`customer`, `officer`,
  `board`). Playwright starts the server in test mode on a temporary database
  and the client on `127.0.0.1:5173`. Tests run one at a time (`workers: 1`)
  because they share one server and reset it before each test.
  Stop any `dev:server` / `dev:client` already running first: Playwright would
  reuse them, and the reset only works in test mode.

## API (Sprint 1)

| Method | Path | Success | Errors |
| ------ | ---- | ------- | ------ |
| GET | `/api/health` | 200 `{status}` | |
| GET | `/api/services` | 200 `{services}` | |
| POST | `/api/tickets` | 201 ticket | 400 invalid body, 404 unknown service type |
| GET | `/api/counters` | 200 `{counters}` | |
| POST | `/api/counters/:id/next` | 200 called ticket, 204 nobody waiting | 400 invalid id, 404 unknown counter |
| GET | `/api/counters/:id/current` | 200 ticket being served, 204 none | 400 invalid id, 404 unknown counter |
| GET | `/api/board` | 200 board state | |
| GET | `/api/board/events` | 200 `text/event-stream` | |
| POST | `/api/test/reset` | 204 | 403 unless `NODE_ENV=test` |

All errors use the body `{ "error": "message" }`. Any other `/api` path or
method returns 404 with the same body. Full contract: `docs/openapi.yaml`.

## Tech decisions

- **Node + Express** backend, **React + Vite** frontend, one language everywhere.
- **SQLite** (`sqlite3`) for storage, behind `store.js` and the DAOs. Tickets
  keep their history (status `waiting`, `called`, ...) for future statistics.
- **API-first**: `docs/openapi.yaml` is the contract; frontend and backend work
  in parallel against it.
- **SSE** for the display board: one-way server → board updates, no extra library.
- **Testing**: Vitest everywhere, Supertest for HTTP, React Testing Library for
  the client, Playwright for E2E.

## Git workflow

- `main`: reviewed, demo-ready code only. Default branch.
- `dev`: integration branch for the sprint.
- `story/<name>`: one branch per story, from `dev`; PR into `dev`.
- `task/OQM-xx-<name>`: one branch per task, from the story; PR into the story.
- Every PR is reviewed by another team member before the merge.
- Definition of Done: unit tested, integration + E2E tested, code reviewed, pushed here.
