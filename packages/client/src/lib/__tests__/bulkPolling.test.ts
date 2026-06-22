import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PollingState } from "../bulkPolling.js";

/**
 * Contract tests for the bulk-polling state machine (#87). Two surfaces:
 *  - `isTransientNoSnapshotError` — cold-start error detection
 *  - `createBulkPoller` — start/stop lifecycle, state transitions on
 *     success/503/error, interval scheduling, in-flight guard
 *
 * Mirrors the test patterns in `server/src/services/__tests__/base-poller.test.ts`:
 * fake timers + vi.advanceTimersByTimeAsync for interval walk.
 */

describe("isTransientNoSnapshotError", () => {
  it("should return true when error message starts with 'API 503'", async () => {
    const { isTransientNoSnapshotError } = await import("../bulkPolling.js");

    expect(isTransientNoSnapshotError(new Error("API 503: poller not ready"))).toBe(true);
  });

  it("should return false for non-503 API errors", async () => {
    const { isTransientNoSnapshotError } = await import("../bulkPolling.js");

    expect(isTransientNoSnapshotError(new Error("API 500: internal"))).toBe(false);
    expect(isTransientNoSnapshotError(new Error("API 404: not found"))).toBe(false);
  });

  it("should return false for network errors with no API prefix", async () => {
    const { isTransientNoSnapshotError } = await import("../bulkPolling.js");

    expect(isTransientNoSnapshotError(new Error("network blip"))).toBe(false);
    expect(isTransientNoSnapshotError(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("should return false for non-Error thrown values", async () => {
    const { isTransientNoSnapshotError } = await import("../bulkPolling.js");

    expect(isTransientNoSnapshotError("just a string")).toBe(false);
    expect(isTransientNoSnapshotError(null)).toBe(false);
  });
});

describe("createBulkPoller", () => {
  type Item = { id: number };

  function captureStates<TData>(): {
    states: PollingState<TData>[];
    onState: (s: PollingState<TData>) => void;
  } {
    const states: PollingState<TData>[] = [];
    return { states, onState: (s) => void states.push(s) };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should invoke fetch immediately when start is called", async () => {
    const fetchFn = vi.fn(async () => ({ data: [{ id: 1 }] as Item[], source: "live" as const }));
    const { onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("should emit live data and clear error on successful fetch", async () => {
    const fetchFn = vi.fn(async () => ({ data: [{ id: 1 }] as Item[], source: "live" as const }));
    const { states, onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toEqual({ data: [{ id: 1 }], source: "live", error: null });
  });

  it("should emit cached source when fetch returns cached", async () => {
    const fetchFn = vi.fn(async () => ({ data: [{ id: 1 }] as Item[], source: "cached" as const }));
    const { states, onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)?.source).toBe("cached");
  });

  it("should reset to initialData with null source and no error on 503 (cold start)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("API 503: poller not ready");
    });
    const { states, onState } = captureStates<Item[]>();
    const initialData: Item[] = [];
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData,
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toEqual({ data: initialData, source: null, error: null });
  });

  it("should preserve previous data and set error on non-503 failure", async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call++;
      if (call === 1) return { data: [{ id: 7 }] as Item[], source: "live" as const };
      throw new Error("API 500: internal");
    });
    const { states, onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    const final = states.at(-1)!;
    expect(final.data).toEqual([{ id: 7 }]); // previous data preserved
    expect(final.error?.message).toBe("API 500: internal");
  });

  it("should schedule subsequent polls at intervalMs cadence", async () => {
    const fetchFn = vi.fn(async () => ({ data: [], source: "live" as const }));
    const { onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3500); // 3 more ticks

    expect(fetchFn.mock.calls.length).toBe(4); // 1 immediate + 3 interval
  });

  it("should stop polling and suppress further onState after stop() is called", async () => {
    const fetchFn = vi.fn(async () => ({ data: [], source: "live" as const }));
    const { states, onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const countAfterFirst = states.length;
    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(states.length).toBe(countAfterFirst);
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  it("should skip overlapping ticks when inFlightGuard is true", async () => {
    let resolveFirst: ((v: { data: Item[]; source: "live" }) => void) | null = null;
    const fetchFn = vi.fn(() => {
      if (!resolveFirst) {
        return new Promise<{ data: Item[]; source: "live" }>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve({ data: [], source: "live" as const });
    });
    const { onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      inFlightGuard: true,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(3000); // 3 ticks while first still in flight

    expect(fetchFn.mock.calls.length).toBe(1); // overlapping ticks skipped
    resolveFirst!({ data: [], source: "live" });
  });

  it("should allow overlapping fetches when inFlightGuard is false (default)", async () => {
    let resolveFirst: ((v: { data: Item[]; source: "live" }) => void) | null = null;
    const fetchFn = vi.fn(() => {
      if (!resolveFirst) {
        return new Promise<{ data: Item[]; source: "live" }>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve({ data: [], source: "live" as const });
    });
    const { onState } = captureStates<Item[]>();
    const { createBulkPoller } = await import("../bulkPolling.js");
    const poller = createBulkPoller<Item[]>({
      fetch: fetchFn,
      initialData: [],
      intervalMs: 1000,
      onState,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(3000); // 3 ticks while first still in flight

    expect(fetchFn.mock.calls.length).toBeGreaterThan(1); // overlap allowed
    resolveFirst!({ data: [], source: "live" });
  });
});
