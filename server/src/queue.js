// Generic FIFO queue backed by a singly linked list.
// It knows nothing about tickets or services: it just stores values in order.
// Every operation is O(1), except toArray() which is O(n).
//
// Invariant: empty queue <=> #head === null <=> #tail === null <=> #size === 0

// Internal list node (not exported): a stored value and a link to the next node.
class Node {
  constructor(value) {
    this.value = value
    this.next = null // null when this is the last node
  }
}

export class Queue {
  #head = null // first node: next to be dequeued
  #tail = null // last node: where new values are appended
  #size = 0 // number of elements, kept as a counter so size() is O(1)

  /**
   * Adds a value at the end of the queue.
   * @param {*} value - Any value to store.
   */
  enqueue(value) {
    const node = new Node(value)
    if (this.#tail === null) {
      // Empty queue: the new node is both head and tail
      this.#head = node
    } else {
      this.#tail.next = node
    }
    this.#tail = node
    this.#size++
  }

  /**
   * Removes and returns the first value.
   * @returns {*} The first value, or null if the queue is empty.
   */
  dequeue() {
    if (this.#head === null) return null
    const { value } = this.#head
    this.#head = this.#head.next
    // Removed the last element: reset tail too, otherwise the next
    // enqueue would attach to a node that is no longer in the queue
    if (this.#head === null) this.#tail = null
    this.#size--
    return value
  }

  /**
   * Returns the first value without removing it.
   * @returns {*} The first value, or null if the queue is empty.
   */
  peek() {
    return this.#head === null ? null : this.#head.value
  }

  /**
   * @returns {number} Number of elements in the queue.
   */
  size() {
    return this.#size
  }

  /**
   * @returns {boolean} True if the queue has no elements.
   */
  isEmpty() {
    return this.#size === 0
  }

  /**
   * Removes all elements.
   */
  clear() {
    this.#head = null
    this.#tail = null
    this.#size = 0
  }

  /**
   * Returns the values from first to last.
   * @returns {Array} A new array: changing it does not affect the queue.
   */
  toArray() {
    const values = []
    for (let node = this.#head; node !== null; node = node.next) {
      values.push(node.value)
    }
    return values
  }
}
