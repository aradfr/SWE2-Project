import { describe, it, expect } from 'vitest'

describe('store lifecycle', () => {
  it('closes cleanly before the database is initialized', async () => {
    const { close } = await import('../../src/store.js')
    await expect(close()).resolves.toBeUndefined()
  })
})