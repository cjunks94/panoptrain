import { describe, it, expect } from "vitest";
import { MinHeap } from "../min-heap.js";

describe("MinHeap", () => {
  it("pops in ascending order", () => {
    const h = new MinHeap<number>((a, b) => a - b);
    for (const n of [5, 3, 9, 1, 7, 2, 8]) h.push(n);
    const out: number[] = [];
    while (h.size > 0) out.push(h.pop()!);
    expect(out).toEqual([1, 2, 3, 5, 7, 8, 9]);
  });

  it("returns undefined when empty", () => {
    const h = new MinHeap<number>((a, b) => a - b);
    expect(h.pop()).toBeUndefined();
    expect(h.size).toBe(0);
  });

  it("tracks size across interleaved push and pop", () => {
    const h = new MinHeap<number>((a, b) => a - b);
    h.push(2);
    h.push(1);
    expect(h.size).toBe(2);
    expect(h.pop()).toBe(1);
    h.push(0);
    expect(h.size).toBe(2);
    expect(h.pop()).toBe(0);
    expect(h.pop()).toBe(2);
    expect(h.size).toBe(0);
  });

  /**
   * The behaviour that matters for the planner: the old frontier was a stable
   * sort followed by shift(), so equal-cost entries came out in insertion
   * order. A raw heap does not guarantee that, which would change which of
   * several equal-cost plans is returned.
   */
  it("preserves insertion order among equal keys when tie-broken on seq", () => {
    interface Item {
      cost: number;
      seq: number;
      tag: string;
    }
    const h = new MinHeap<Item>((a, b) => a.cost - b.cost || a.seq - b.seq);
    for (const tag of ["a", "b", "c", "d", "e", "f"]) {
      h.push({ cost: 1, seq: h.nextSeq(), tag });
    }
    const out: string[] = [];
    while (h.size > 0) out.push(h.pop()!.tag);
    expect(out).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("matches sort-then-shift on a randomized mixed workload", () => {
    // Deterministic LCG so the case is reproducible on failure.
    let state = 12345;
    const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;

    interface Item {
      cost: number;
      seq: number;
    }
    const h = new MinHeap<Item>((a, b) => a.cost - b.cost || a.seq - b.seq);
    const reference: Item[] = [];
    const heapOut: Item[] = [];
    const refOut: Item[] = [];

    for (let i = 0; i < 2000; i++) {
      if (rnd() < 0.6 || reference.length === 0) {
        const item = { cost: Math.floor(rnd() * 20), seq: h.nextSeq() };
        h.push(item);
        reference.push(item);
      } else {
        reference.sort((a, b) => a.cost - b.cost || a.seq - b.seq);
        refOut.push(reference.shift()!);
        heapOut.push(h.pop()!);
      }
    }
    while (h.size > 0) {
      reference.sort((a, b) => a.cost - b.cost || a.seq - b.seq);
      refOut.push(reference.shift()!);
      heapOut.push(h.pop()!);
    }

    expect(heapOut).toEqual(refOut);
  });
});
