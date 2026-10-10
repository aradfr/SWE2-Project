import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

// Test settings live here so vite.config.js (dev server, build) stays as it is.
// jsdom gives components a browser-like DOM; the setup file adds the
// jest-dom matchers (toBeInTheDocument, toBeDisabled, ...).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.js'],
      include: ['test/**/*.test.{js,jsx}'],
      restoreMocks: true,
    },
  }),
)
