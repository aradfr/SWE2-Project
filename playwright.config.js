import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'

// The E2E server uses its own SQLite file: the development database is never touched.
const E2E_DB = path.join(os.tmpdir(), 'oqm-e2e.db')

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  // All tests share one server and reset it before each test: run them one at a time.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NODE_ENV: 'test',
        PORT: '3001',
        SQLITE_DB_PATH: E2E_DB,
      },
    },
    {
      command: 'npm run dev -w client -- --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
})
