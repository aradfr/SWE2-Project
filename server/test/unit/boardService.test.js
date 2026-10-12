/* Unit tests of boardService.js. The store is mocked: the service must return
the board read from the store, unchanged. The SQL is tested in store.test.js. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBoardState } from '../../src/services/boardService.js'
import { getBoardData } from '../../src/store.js'

vi.mock('../../src/store.js', () => ({ getBoardData: vi.fn() }))

const board = {
  A: {
    name: 'Payments',
    queueLength: 1,
    lastCalledTickets: [{ code: 'A001', counterId: 1, calledAt: '2026-10-11T09:30:00Z' }],
  },
  B: { name: 'Banking', queueLength: 0, lastCalledTickets: [] },
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getBoardState', () => {
  it('reads the board from the store once', async () => {
    getBoardData.mockResolvedValue(board)
    await getBoardState()
    expect(getBoardData).toHaveBeenCalledOnce()
    expect(getBoardData).toHaveBeenCalledWith()
  })

  it('returns the board grouped by service tag', async () => {
    getBoardData.mockResolvedValue(board)
    expect(await getBoardState()).toEqual(board)
  })

  it('returns an empty board when the office has no services', async () => {
    getBoardData.mockResolvedValue({})
    expect(await getBoardState()).toEqual({})
  })

  it('rejects when the store fails', async () => {
    getBoardData.mockRejectedValue(new Error('SQLITE_BUSY'))
    await expect(getBoardState()).rejects.toThrow('SQLITE_BUSY')
  })
})
