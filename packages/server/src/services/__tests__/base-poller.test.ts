import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Logger } from "../../lib/logger.js";

/**
 * Contract tests for the shared poller primitives (#85). Two surfaces:
 *
 *  - `fetchWithRetry` — retry, abort, error-cause preservation
 *  - `createSnapshotPoller` — cache fallback, TTL eviction, stop() aborts
 *    in-flight, structured logging on ok / cache / hard-fail
 *
 * Mirrors the test patterns already in airspace-poller.test.ts: fake
 * timers + vi.advanceTimersByTimeAsync to walk the retry backoff,
 * mock fetch via vi.spyOn(globalThis, "fetch").
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeLoggerSpy(): Logger & { calls: { level: string; msg: string; ctx?: Record<string, unknown> }[] } {
  const calls: { level: string; msg: string; ctx?: Record<string, unknown> }[] = [];
  return {
    calls,
    info: (msg, ctx) => void calls.push({ level: "info", msg, ctx }),
    warn: (msg, ctx) => void calls.push({ level: "warn", msg, ctx }),
    error: (msg, ctx) => void calls.push({ level: "error", msg, ctx }),
  };
}

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should return the parsed payload when the first attempt succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { fetchWithRetry } = await import("../base-poller.js");

    const result = await fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => (await r.json()) as { ok: boolean },
      timeoutMs: 5_000,
      retryDelaysMs: [0, 500, 1_500],
    });

    expect(result).toEqual({ ok: true });
  });

  it("should retry and succeed on a later attempt when earlier attempts throw", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { fetchWithRetry } = await import("../base-poller.js");

    const promise = fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => (await r.json()) as { ok: boolean },
      timeoutMs: 5_000,
      retryDelaysMs: [0, 500],
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("should treat non-ok HTTP responses as retryable failures", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { fetchWithRetry } = await import("../base-poller.js");

    const promise = fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => (await r.json()) as { ok: boolean },
      timeoutMs: 5_000,
      retryDelaysMs: [0, 500],
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("should throw an Error whose cause is the last underlying failure when retries are exhausted", async () => {
    const underlying = new Error("upstream gone");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(underlying);
    const { fetchWithRetry } = await import("../base-poller.js");

    const promise = fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => r.json(),
      timeoutMs: 5_000,
      retryDelaysMs: [0, 500, 1_500],
    });
    promise.catch(() => {}); // pin rejection so vitest doesn't complain about unhandled
    await vi.advanceTimersByTimeAsync(3_000);

    const err = await promise.catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.cause).toBe(underlying);
  });

  it("should pass headers through to the underlying fetch call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({}));
    const { fetchWithRetry } = await import("../base-poller.js");

    await fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => r.json(),
      headers: { "User-Agent": "panoptrain-test", accept: "application/json" },
      timeoutMs: 5_000,
      retryDelaysMs: [0],
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "User-Agent": "panoptrain-test", accept: "application/json" });
  });

  it("should reject and skip remaining retries when the external signal aborts", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blip"));
    const { fetchWithRetry } = await import("../base-poller.js");

    const promise = fetchWithRetry({
      url: "https://example.test",
      parse: async (r) => r.json(),
      timeoutMs: 5_000,
      retryDelaysMs: [0, 1_000, 5_000],
      signal: controller.signal,
    });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error("stopping"));
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).rejects.toThrow(/stopping|abort/i);
  });
});

describe("createSnapshotPoller", () => {
  interface FakeSnapshot {
    timestamp: number;
    source: "live" | "cached";
    items: string[];
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup(overrides: { fetchSnapshot?: () => Promise<FakeSnapshot> } = {}) {
    const logger = makeLoggerSpy();
    const fetchSnapshot = overrides.fetchSnapshot ??
      vi.fn(async () => ({ timestamp: Date.now(), source: "live", items: ["a"] } as FakeSnapshot));
    return { logger, fetchSnapshot };
  }

  it("should set getCurrent to the live snapshot after a successful pollOnce", async () => {
    const { logger, fetchSnapshot } = setup();
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
    });

    await poller.pollOnce();

    expect(poller.getCurrent()?.source).toBe("live");
    expect(poller.getCurrent()?.items).toEqual(["a"]);
  });

  it("should serve the previously-cached snapshot with source flipped to cached when the live fetch fails within TTL", async () => {
    const { logger } = setup();
    let call = 0;
    const fetchSnapshot = vi.fn(async () => {
      call++;
      if (call === 1) return { timestamp: Date.now(), source: "live", items: ["first"] } as FakeSnapshot;
      throw new Error("upstream down");
    });
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
      toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
    });

    await poller.pollOnce();
    await poller.pollOnce();

    const current = poller.getCurrent();
    expect(current?.source).toBe("cached");
    expect(current?.items).toEqual(["first"]);
  });

  it("should return null from getCurrent when the live fetch fails and no cache exists", async () => {
    const { logger } = setup();
    const fetchSnapshot = vi.fn(async () => {
      throw new Error("upstream down");
    });
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
    });

    await poller.pollOnce();

    expect(poller.getCurrent()).toBeNull();
  });

  it("should evict the cache and return null when the cached snapshot is older than TTL", async () => {
    const { logger } = setup();
    let call = 0;
    const fetchSnapshot = vi.fn(async () => {
      call++;
      if (call === 1) return { timestamp: Date.now(), source: "live", items: ["first"] } as FakeSnapshot;
      throw new Error("upstream down");
    });
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 1_000,
      logger,
      toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
    });

    await poller.pollOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await poller.pollOnce();

    expect(poller.getCurrent()).toBeNull();
  });

  it("should emit a structured info log with the name prefix on successful poll", async () => {
    const { logger, fetchSnapshot } = setup();
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "airspace",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
      formatStats: (s) => `${s.items.length} items`,
    });

    await poller.pollOnce();

    const infoCall = logger.calls.find((c) => c.level === "info");
    expect(infoCall).toBeDefined();
    expect(infoCall!.ctx).toMatchObject({ poller: "airspace" });
  });

  it("should emit a structured warn log when falling back to the cached snapshot", async () => {
    const { logger } = setup();
    let call = 0;
    const fetchSnapshot = vi.fn(async () => {
      call++;
      if (call === 1) return { timestamp: Date.now(), source: "live", items: ["first"] } as FakeSnapshot;
      throw new Error("upstream down");
    });
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "metar",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
      toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
    });

    await poller.pollOnce();
    await poller.pollOnce();

    const warnCall = logger.calls.find((c) => c.level === "warn");
    expect(warnCall).toBeDefined();
    expect(warnCall!.ctx).toMatchObject({ poller: "metar" });
  });

  it("should clear the polling interval and stop firing pollOnce after stop() is called", async () => {
    const { logger, fetchSnapshot } = setup();
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
    });

    poller.start(1_000);
    await vi.advanceTimersByTimeAsync(50); // let initial poll resolve
    const initialCallCount = (fetchSnapshot as ReturnType<typeof vi.fn>).mock.calls.length;
    poller.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect((fetchSnapshot as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCallCount);
  });

  it("should abort the in-flight fetch signal when stop() is called mid-request", async () => {
    const { logger } = setup();
    let receivedSignal: AbortSignal | null = null;
    const fetchSnapshot = vi.fn(async (signal: AbortSignal) => {
      receivedSignal = signal;
      // never resolves on its own — only an abort can terminate this.
      return new Promise<FakeSnapshot>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
    });

    poller.start(1_000);
    await vi.advanceTimersByTimeAsync(10);
    expect(receivedSignal!.aborted).toBe(false);
    poller.stop();

    expect(receivedSignal!.aborted).toBe(true);
  });

  it("should reset internal state via __TEST_INTERNALS__.reset", async () => {
    const { logger, fetchSnapshot } = setup();
    const { createSnapshotPoller } = await import("../base-poller.js");
    const poller = createSnapshotPoller<FakeSnapshot>({
      name: "test",
      fetchSnapshot,
      cacheTtlMs: 60_000,
      logger,
    });

    await poller.pollOnce();
    expect(poller.getCurrent()).not.toBeNull();
    poller.__TEST_INTERNALS__.reset();

    expect(poller.getCurrent()).toBeNull();
  });
});
