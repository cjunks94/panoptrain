import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBulkPoller, MAX_BACKOFF_MS, type PollingState } from "../bulkPolling.js";

/**
 * Regression coverage for #132 (out-of-order responses) and #133 (no backoff).
 *
 * Both only appear under conditions a single-call test can't create: a slow
 * or failing network across many ticks. Each test here drives the timeline
 * explicitly with fake timers.
 */

const INTERVAL = 1_000;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("#132 — out-of-order responses", () => {
  it("should ignore a slow earlier response that lands after a newer one", async () => {
    const first = deferred<{ data: string; source: "live" }>();
    const second = deferred<{ data: string; source: "live" }>();
    const queue = [first, second];
    const states: PollingState<string>[] = [];

    const poller = createBulkPoller<string>({
      fetch: () => queue.shift()!.promise,
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: (s) => states.push(s),
    });

    poller.start(); // fires poll #0 immediately
    await vi.advanceTimersByTimeAsync(INTERVAL); // fires poll #1

    // Newer response lands first...
    second.resolve({ data: "newer", source: "live" });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.data).toBe("newer");

    // ...then the older one finally arrives and must be dropped.
    first.resolve({ data: "older", source: "live" });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.data).toBe("newer");

    poller.stop();
  });

  it("should apply responses that arrive in order", async () => {
    let n = 0;
    const states: PollingState<number>[] = [];
    const poller = createBulkPoller<number>({
      fetch: async () => ({ data: ++n, source: "live" as const }),
      initialData: 0,
      intervalMs: INTERVAL,
      onState: (s) => states.push(s),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(states.map((s) => s.data)).toEqual([1, 2, 3]);
    poller.stop();
  });
});

describe("#133 — backoff on repeated failure", () => {
  it("should stop polling at full cadence while the server is down", async () => {
    let calls = 0;
    const poller = createBulkPoller<string>({
      fetch: async () => {
        calls++;
        throw new Error("network down");
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    // First backoff is one interval; the steady interval is paused.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(2);

    // Second failure doubles it — nothing at +1 interval.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(3);

    poller.stop();
  });

  it("should recover full cadence after a success", async () => {
    let calls = 0;
    let failing = true;
    const poller = createBulkPoller<string>({
      fetch: async () => {
        calls++;
        if (failing) throw new Error("down");
        return { data: "ok", source: "live" as const };
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL); // backed-off retry, still failing
    const beforeRecovery = calls;

    failing = false;
    await vi.advanceTimersByTimeAsync(INTERVAL * 2); // next backed-off retry succeeds
    const afterSuccess = calls;
    expect(afterSuccess).toBeGreaterThan(beforeRecovery);

    // Steady interval restored: two more ticks give two more calls.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(afterSuccess + 2);

    poller.stop();
  });

  it("should not back off on a cold-start 503", async () => {
    // The server's poller has no snapshot yet — it is up and about to have
    // data, so full cadence is correct here.
    let calls = 0;
    const poller = createBulkPoller<string>({
      fetch: async () => {
        calls++;
        throw new Error("API 503: no snapshot yet");
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(3); // no backoff applied

    poller.stop();
  });

  it("should cap the backoff", async () => {
    let calls = 0;
    const poller = createBulkPoller<string>({
      fetch: async () => {
        calls++;
        throw new Error("down");
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    // Run well past the point where uncapped growth would exceed the cap.
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    const at = calls;
    // Still retrying at the capped rate, not stalled forever.
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS);
    expect(calls).toBeGreaterThan(at);

    poller.stop();
  });

  it("should clear a pending backoff timer on stop", async () => {
    let calls = 0;
    const poller = createBulkPoller<string>({
      fetch: async () => {
        calls++;
        throw new Error("down");
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    const at = calls;
    poller.stop();

    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS * 2);
    expect(calls).toBe(at); // nothing fired after stop
  });
});

describe("inFlightGuard", () => {
  it("should skip a tick while a fetch is still pending", async () => {
    const pending = deferred<{ data: string; source: "live" }>();
    let calls = 0;
    const poller = createBulkPoller<string>({
      fetch: () => {
        calls++;
        return pending.promise;
      },
      initialData: "initial",
      intervalMs: INTERVAL,
      inFlightGuard: true,
      onState: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(1); // still guarded

    pending.resolve({ data: "done", source: "live" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(calls).toBe(2); // released

    poller.stop();
  });
});
