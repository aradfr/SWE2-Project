// Runs before every client test file.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount rendered components between tests so they never leak into each other.
afterEach(() => {
  cleanup()
})
