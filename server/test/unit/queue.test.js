import { describe, it, expect, beforeEach } from 'vitest'
import { Queue } from '../../src/queue.js'

describe('Queue', () => {
  let queue

  beforeEach(() => {
    queue = new Queue()
  })

  describe('new queue', () => {
    it('is empty: size 0, isEmpty true, peek and dequeue return null, toArray returns []', () => {
      expect(queue.size()).toBe(0)
      expect(queue.isEmpty()).toBe(true)
      expect(queue.peek()).toBeNull()
      expect(queue.dequeue()).toBeNull()
      expect(queue.toArray()).toEqual([])
    })
  })

  describe('enqueue', () => {
    it('adds values at the end: size 3, not empty, toArray in insertion order', () => {
      queue.enqueue(1)
      queue.enqueue(2)
      queue.enqueue(3)

      expect(queue.size()).toBe(3)
      expect(queue.isEmpty()).toBe(false)
      expect(queue.toArray()).toEqual([1, 2, 3])
    })
  })

  describe('peek', () => {
    it('returns the first value without removing it', () => {
      queue.enqueue(1)
      queue.enqueue(2)
      queue.enqueue(3)

      expect(queue.peek()).toBe(1)
      expect(queue.size()).toBe(3)
    })
  })

  describe('dequeue', () => {
    it('returns values in FIFO order and leaves the queue empty', () => {
      queue.enqueue(1)
      queue.enqueue(2)
      queue.enqueue(3)

      expect([queue.dequeue(), queue.dequeue(), queue.dequeue()]).toEqual([1, 2, 3])
      expect(queue.size()).toBe(0)
      expect(queue.isEmpty()).toBe(true)
      expect(queue.peek()).toBeNull()
    })

    it('returns null on an empty queue and keeps size at 0', () => {
      expect(queue.dequeue()).toBeNull()
      expect(queue.size()).toBe(0)
    })

    // Dequeuing the last element must also reset the tail; otherwise the next
    // enqueue attaches to a removed node and the new value is lost.
    it('accepts new values after being emptied (tail is reset)', () => {
      queue.enqueue(1)
      queue.dequeue()

      queue.enqueue('x')
      expect(queue.peek()).toBe('x')
      expect(queue.size()).toBe(1)
      expect(queue.toArray()).toEqual(['x'])

      queue.enqueue('y')
      expect(queue.toArray()).toEqual(['x', 'y'])
    })
  })

  describe('toArray', () => {
    it('returns a copy: changing it does not change the queue', () => {
      queue.enqueue('x')
      queue.enqueue('y')

      const values = queue.toArray()
      values.push('z')
      values[0] = 'CHANGED'

      expect(queue.toArray()).toEqual(['x', 'y'])
    })
  })

  describe('clear', () => {
    it('empties the queue and leaves it reusable', () => {
      queue.enqueue(1)
      queue.enqueue(2)

      queue.clear()
      expect(queue.size()).toBe(0)
      expect(queue.peek()).toBeNull()
      expect(queue.toArray()).toEqual([])

      queue.enqueue(7)
      expect(queue.peek()).toBe(7)
      expect(queue.size()).toBe(1)
      expect(queue.toArray()).toEqual([7])
    })
  })

  describe('mixed usage', () => {
    it('keeps FIFO order with interleaved enqueue and dequeue', () => {
      queue.enqueue(1)
      queue.enqueue(2)
      queue.dequeue()
      queue.enqueue(3)
      queue.dequeue()
      queue.dequeue()
      queue.enqueue(4)
      queue.enqueue(5)

      expect(queue.toArray()).toEqual([4, 5])
      expect(queue.size()).toBe(2)
    })

    // Falsy values are real elements: they must not be confused with "empty".
    it('stores and counts falsy values (0, empty string, false)', () => {
      queue.enqueue(0)
      queue.enqueue('')
      queue.enqueue(false)

      expect(queue.size()).toBe(3)
      expect(queue.dequeue()).toBe(0)
      expect(queue.dequeue()).toBe('')
      expect(queue.dequeue()).toBe(false)
    })

    it('returns 1000 values in FIFO order and then is empty', () => {
      for (let i = 0; i < 1000; i++) queue.enqueue(i)

      const dequeued = []
      for (let i = 0; i < 1000; i++) dequeued.push(queue.dequeue())

      expect(dequeued).toEqual(Array.from({ length: 1000 }, (_, i) => i))
      expect(queue.size()).toBe(0)
      expect(queue.dequeue()).toBeNull()
    })
  })

  describe('encapsulation', () => {
    // head, tail and size are private fields: callers can only use the methods.
    it('exposes no public head, tail or size fields', () => {
      queue.enqueue(1)

      expect(Object.keys(queue)).toEqual([])
      expect(queue.head).toBeUndefined()
      expect(queue.tail).toBeUndefined()
    })
  })
})
