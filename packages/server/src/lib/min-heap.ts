/**
 * Binary min-heap used as the Dijkstra frontier in the subway trip planner
 * (#127).
 *
 * The frontier was previously a plain array re-sorted on every dequeue, which
 * made the search superlinear in the number of seeded sources and turned an
 * unbounded `from` list into an event-loop stall.
 *
 * Tie-breaking note: the previous implementation called `Array.sort()` (stable
 * in V8) and then `shift()`, so among equal-cost entries the earliest-inserted
 * one was always dequeued first. A raw binary heap gives no such guarantee, and
 * changing it would silently change *which* of several equal-cost plans the
 * planner returns. `push` therefore stamps a monotonic sequence number and
 * callers are expected to tie-break on it, preserving the previous ordering
 * exactly. See `planTrip`'s comparator.
 */
export class MinHeap<T> {
  private readonly items: T[] = [];
  private seq = 0;

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  /** Monotonic insertion counter, for callers that need stable tie-breaking. */
  nextSeq(): number {
    return this.seq++;
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(start: number): void {
    let i = start;
    const item = this.items[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(item, this.items[parent]) >= 0) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }

  private siftDown(start: number): void {
    let i = start;
    const n = this.items.length;
    const item = this.items[i];
    for (;;) {
      const left = i * 2 + 1;
      if (left >= n) break;
      const right = left + 1;
      const child =
        right < n && this.compare(this.items[right], this.items[left]) < 0 ? right : left;
      if (this.compare(this.items[child], item) >= 0) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = item;
  }
}
