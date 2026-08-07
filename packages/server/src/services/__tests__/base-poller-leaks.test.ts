import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry, createSnapshotPoller } from "../base-poller.js";
import type { Logger } from "../../lib/logger.js";

/**
 * Regression coverage for the three poller lifetime leaks (#128, #141, #140).
 *
 * These all share a shape: something attaches to a signal or claims a slot and
 * never lets go, so nothing is visibly broken until the process has been up
 * for days. Unit tests that assert on a single call can't see them — each test
 * here drives many cycles and asserts the *accumulation* is bounded.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** Reads Node's internal dependant-signal set, which is what `AbortSignal.any`
 *  grows and never prunes. Returns 0 when the symbol is absent. */
function dependantCount(signal: AbortSignal): number {
  const sym = Object.getOwnPropertySymbols(signal).find((s) =>
    /ependantSignals/.test(String(s)),
  );
  if (!sym) return 0;
  const set = (signal as unknown as Record<symbol, { size?: number }>)[sym];
  return set?.size ?? 0;
}

describe("#128 — long-lived signal does not accumulate state", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should remove every listener it adds to the caller's signal", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;

    // One controller for the whole run, mirroring a poller's process-lifetime
    // signal.
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    for (let i = 0; i < 100; i++) {
      await fetchWithRetry({
        url: "https://example.test/feed",
        parse: async (r) => r.text(),
        timeoutMs: 5_000,
        retryDelaysMs: [0],
        signal: controller.signal,
      });
    }

    expect(addSpy.mock.calls.length).toBeGreaterThan(0); // sanity: it did attach
    expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length);
  });

  it("should not register dependant signals on the caller's signal", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const controller = new AbortController();

    for (let i = 0; i < 100; i++) {
      await fetchWithRetry({
        url: "https://example.test/feed",
        parse: async (r) => r.text(),
        timeoutMs: 5_000,
        retryDelaysMs: [0],
        signal: controller.signal,
      });
    }

    // AbortSignal.any would leave 100 entries here, never pruned.
    expect(dependantCount(controller.signal)).toBe(0);
  });

  it("should not accumulate listeners across failing attempts with retries", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 503 })) as typeof fetch;
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    // 3 attempts each, with sleeps between — exercises both the attempt
    // signal and the sleep listener on every iteration.
    for (let i = 0; i < 20; i++) {
      await expect(
        fetchWithRetry({
          url: "https://example.test/feed",
          parse: async (r) => r.text(),
          timeoutMs: 5_000,
          retryDelaysMs: [0, 1, 1],
          signal: controller.signal,
        }),
      ).rejects.toThrow(/HTTP 503/);
    }

    expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length);
    expect(dependantCount(controller.signal)).toBe(0);
  });

  it("should still abort in-flight work when the long-lived signal fires", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = fetchWithRetry({
      url: "https://example.test/feed",
      parse: async (r) => r.text(),
      timeoutMs: 5_000,
      retryDelaysMs: [0],
      signal: controller.signal,
    });

    controller.abort(new Error("poller stopped"));
    await expect(promise).rejects.toThrow(/poller stopped|abort/i);
  });

  it("should reject immediately when the signal is already aborted", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok")) as typeof fetch;
    const controller = new AbortController();
    controller.abort(new Error("already stopped"));

    await expect(
      fetchWithRetry({
        url: "https://example.test/feed",
        parse: async (r) => r.text(),
        timeoutMs: 5_000,
        retryDelaysMs: [0],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/already stopped/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("#140 — snapshot poller does not overlap itself", () => {
  let release: (() => void) | null = null;
  let calls = 0;

  function slowPoller(logger: Logger = silentLogger) {
    calls = 0;
    return createSnapshotPoller<string>({
      name: "test",
      fetchSnapshot: async () => {
        calls++;
        await new Promise<void>((r) => {
          release = r;
        });
        return "snap";
      },
      cacheTtlMs: 60_000,
      logger,
    });
  }

  beforeEach(() => {
    release = null;
    calls = 0;
  });

  it("should skip a tick while the previous poll is still running", async () => {
    const poller = slowPoller();
    const first = poller.pollOnce();
    await Promise.resolve();
    expect(calls).toBe(1);

    // Second tick arrives before the first resolves.
    await poller.pollOnce();
    expect(calls).toBe(1); // skipped, not queued

    release?.();
    await first;
    expect(calls).toBe(1);
  });

  it("should log a warning when a tick is skipped", async () => {
    const warn = vi.fn();
    const poller = slowPoller({ ...silentLogger, warn } as unknown as Logger);
    const first = poller.pollOnce();
    await Promise.resolve();
    await poller.pollOnce();

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/skipped/i),
      expect.objectContaining({ poller: "test" }),
    );
    release?.();
    await first;
  });

  it("should accept a new poll once the previous one completes", async () => {
    const poller = slowPoller();
    const first = poller.pollOnce();
    await Promise.resolve();
    release?.();
    await first;

    const second = poller.pollOnce();
    await Promise.resolve();
    expect(calls).toBe(2); // no longer blocked
    release?.();
    await second;
  });

  it("should release the guard when the poll throws", async () => {
    let shouldThrow = true;
    let n = 0;
    const poller = createSnapshotPoller<string>({
      name: "test",
      fetchSnapshot: async () => {
        n++;
        if (shouldThrow) throw new Error("upstream down");
        return "snap";
      },
      cacheTtlMs: 60_000,
      logger: silentLogger,
    });

    await poller.pollOnce();
    expect(n).toBe(1);
    shouldThrow = false;
    await poller.pollOnce();
    expect(n).toBe(2); // guard was released by the finally, not stuck
  });

  it("should release the guard on stop() so a restart is not wedged", async () => {
    // Each poll parks on its own resolver so stopping one doesn't strand the
    // other — the shared `release` in slowPoller() only tracks the latest.
    const releases: (() => void)[] = [];
    let n = 0;
    const poller = createSnapshotPoller<string>({
      name: "test",
      fetchSnapshot: async () => {
        n++;
        await new Promise<void>((r) => releases.push(r));
        return "snap";
      },
      cacheTtlMs: 60_000,
      logger: silentLogger,
    });

    const first = poller.pollOnce();
    await Promise.resolve();
    expect(n).toBe(1);

    poller.stop(); // aborts the in-flight poll

    const second = poller.pollOnce();
    await Promise.resolve();
    expect(n).toBe(2); // a fresh poll is accepted rather than skipped

    releases.forEach((r) => r());
    await Promise.all([first, second]);
  });
});
