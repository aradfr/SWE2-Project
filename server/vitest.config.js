import { defineConfig } from 'vitest/config'

// Run the tests in a fixed time zone, whatever the machine (local PC or CI).
// The store uses the LOCAL date to detect a new day; the "local midnight" test
// can catch a UTC-based date (e.g. toISOString()) only in a zone ahead of UTC.
// Set before the config is exported, so the test workers inherit it.
process.env.TZ = 'Europe/Rome'

export default defineConfig({})
