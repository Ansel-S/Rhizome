/**
 * @fileoverview Async Semaphore — bounded concurrency primitive
 *
 * Usage:
 *   const sem = new Semaphore(20);
 *   const results = await sem.map(urls, url => fetch(url));
 */

export class Semaphore {
  /** @type {Array<() => void>} */
  #queue = [];
  #available;

  /** @param {number} concurrency */
  constructor(concurrency) {
    if (concurrency < 1) throw new RangeError('concurrency must be ≥ 1');
    this.#available = concurrency;
  }

  /** Acquire one slot. Resolves immediately or queues until a slot is free. */
  acquire() {
    if (this.#available > 0) {
      this.#available--;
      return Promise.resolve();
    }
    return new Promise(resolve => this.#queue.push(resolve));
  }

  /** Release one slot back to the pool. */
  release() {
    if (this.#queue.length > 0) {
      // Hand the slot directly to the next waiter — no increment needed
      this.#queue.shift()();
    } else {
      this.#available++;
    }
  }

  /**
   * Run an async function with one slot acquired.
   * Guarantees release even on throw.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Process an array with bounded parallelism — equivalent to
   * `Promise.all(items.map(fn))` but capped at `concurrency` in-flight.
   *
   * @template T, R
   * @param {T[]} items
   * @param {(item: T, index: number) => Promise<R>} fn
   * @returns {Promise<R[]>}
   */
  map(items, fn) {
    return Promise.all(items.map((item, i) => this.run(() => fn(item, i))));
  }

  /** Current number of available slots (read-only). */
  get available() { return this.#available; }

  /** Number of waiters in queue (read-only). */
  get queued() { return this.#queue.length; }
}
