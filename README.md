# Office Queue Management System

Software Engineering 2 team project (PoliTO, a.y. 2026/27).
Manages queues for desk services open to the public (post office, medical office):
customers take a ticket for a service type, officers call the next customer,
a display board shows queue lengths, managers see statistics.

## Repository layout

```
server/   Express REST API (ES modules)
client/   React + Vite frontend
e2e/      Playwright end-to-end tests
docs/     openapi.yaml - the API contract (also served live at /api/docs)
```

## Tech decisions (Sprint 1)

- **Node 22 + Express** backend, **React + Vite** frontend, one language everywhere.
- **In-memory storage**: the spec resets all queues every morning and has no
  persistence requirement, so no DB in sprint 1. The storage layer is isolated
  in `server/src/store.js` so a real DB can replace it without touching routes.
- **API-first**: `docs/openapi.yaml` is the contract. Frontend and backend work
  happen in parallel against it. Interactive docs at `http://localhost:3001/api/docs`.
- **Testing**: Vitest everywhere, Supertest for HTTP integration tests,
  React Testing Library for the client, Playwright for E2E.

## Quick start

```bash
npm install                 # installs server + client (npm workspaces)
npm run dev:server          # API on http://localhost:3001
npm run dev:client          # UI on http://localhost:5173 (proxies /api to 3001)
```

## Client structure

```
client/src/
  main.jsx, App.jsx   entry point and routes (shared)
  theme.css           team palette (shared)
  components/         shared UI: AppNavbar, PageLayout
  api/client.js       apiFetch: the only way to call the server
  api/<role>.js       API functions of each role
  pages/<role>/       pages of each role: customer/, officer/, board/
```

Team rules:

1. Work only in `pages/<role>/` and `api/<role>.js`.
2. `App.jsx`, `main.jsx`, `theme.css` and `components/` are shared: do not edit them to work on a page.
3. No hard-coded colours: use Bootstrap variants (`primary`, `warning`, `danger`...).
   Page CSS is for layout only, in your own folder (`*.module.css`).
4. New libraries only after telling the team, in a separate PR.
5. Always call the server through `apiFetch`.

## Tests

```bash
npm test                    # server + client unit/integration tests
npm run test:e2e            # Playwright E2E (first time: cd e2e && npm install && npx playwright install --with-deps chromium)
```

## Git workflow

- `main`: reviewed, demo-ready code only. Default branch.
- `dev`: integration branch for the sprint. Open PRs to `main`.
- Definition of Done: unit tested, integration + E2E tested, code reviewed, pushed here.

## Ticket codes

Zero-padded daily sequence (`001`, `002`, ...), unique for the whole office.
The spec requires uniqueness per office and a morning reset, so a per-day
counter satisfies both.
