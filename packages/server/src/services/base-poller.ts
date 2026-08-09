import type { Logger } from "../lib/logger.js";

/**
 * Shared polling primitives extracted from mta / airspace / metar / taf
 * pollers (#85). Two layers:
 *
 *  - `fetchWithRetry` — single HTTP fetch with retry/backoff, per-attempt
 *    AbortSignal.timeout, optional external abort signal, and rethrow
 *    that preserves `{ cause }`. All four pollers use this; it kills the
 *    biggest chunk of duplication.
 *
 *  - `createSnapshotPoller` — factory for the single-snapshot pattern
 *    shared by airspace / metar / taf: live fetch on success, fall back
 *    to cached snapshot within TTL on failure, owns setInterval lifecycle
 *    and AbortController so `stop()` cancels any in-flight request.
 *
 * MTA stays on its current multi-feed shape (per-feed cache, parallel
 * Promise.all) — that's structurally different from the snapshot pattern
 * and would distort the factory if forced through it. MTA uses
 * `fetchWithRetry` for its inner per-feed fetch.
 */

export interface FetchWithRetryOptions<T> {
  /** Target URL. Passed through to `fetch`. */
  url: string;
  /** Per-attempt parser. Receives the live `Response`; runs only on `res.ok`. */
  parse: (res: Response) => Promise<T>;
  /** Optional request headers (e.g., User-Agent for adsb.lol / aviationweather). */
  headers?: Record<string, string>;
  /** Per-attempt timeout (ms). Wired via AbortSignal.timeout. */
  timeoutMs: number;
  /**
   * Delay (ms) before each attempt. The first entry is applied before
   * attempt 0 (usually 0); subsequent entries gate retries. The array's
   * length is the total attempt count.
   */
  retryDelaysMs: readonly number[];
  /**
   * Optional external abort signal. If aborted before completion, the
   * function rejects with the abort reason and skips any pending retries.
   */
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === "string" ? signal.reason : "aborted");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    // `{ once: true }` removes the listener only when it FIRES. On the normal
    // path — timer resolves, no abort — the listener would stay attached to
    // the caller's signal forever. Poller signals are long-lived, so during an
    // upstream outage that accumulates a listener per retry indefinitely and
    // triggers MaxListenersExceededWarning storms (#141). Detach explicitly.
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Builds a per-attempt abort signal combining a timeout with an optional
 * long-lived caller signal — deliberately NOT via `AbortSignal.any` (#128).
 *
 * `AbortSignal.any([longLived, timeout])` registers the composite in the
 * source signal's internal dependant set, and Node never prunes it. The
 * entries survive the timeout firing *and* the source aborting — measured at
 * ~2.2KB each on Node 24, retained for the life of the process. With one
 * process-lifetime controller per poller that is ~45MB/day, which OOMs a
 * 512MB container in one to two weeks.
 *
 * Owning the controller lets us detach the listener when the attempt ends,
 * so nothing accumulates on the caller's signal.
 */
function attemptSignal(
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();

  // Match AbortSignal.timeout's rejection shape so callers and tests that
  // check for a timeout see the same DOMException name they did before.
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }, timeoutMs);

  const onAbort = (): void => controller.abort(abortReason(signal!));
  if (signal) {
    if (signal.aborted) controller.abort(abortReason(signal));
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchWithRetry<T>(opts: FetchWithRetryOptions<T>): Promise<T> {
  const { url, parse, headers, timeoutMs, retryDelaysMs, signal } = opts;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    const delay = retryDelaysMs[attempt] ?? 0;
    if (delay > 0) await sleep(delay, signal); // throws on abort

    const attemptSig = attemptSignal(timeoutMs, signal);
    try {
      const res = await fetch(url, { signal: attemptSig.signal, ...(headers ? { headers } : {}) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await parse(res);
    } catch (err) {
      if (signal?.aborted) throw abortReason(signal);
      lastErr = err;
    } finally {
      // Runs after `parse` resolves too, so the timeout still bounds body
      // reads — and the listener never outlives the attempt.
      attemptSig.dispose();
    }
  }

  // Preserve underlying message in `.message` so existing regex assertions
  // (.rejects.toThrow(/HTTP 503/)) keep working; pin the original on `.cause`
  // so callers can chain to root cause without string-parsing.
  const baseMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(baseMsg, { cause: lastErr });
}

export interface SnapshotPollerConfig<T> {
  /** Used as the structured-log prefix (`{name}/ok`, `{name}/cache-fallback`...). */
  name: string;
  /**
   * Fetches one fresh snapshot. Receives an AbortSignal tied to the
   * poller's lifecycle; passing it through to `fetchWithRetry` enables
   * `stop()` to cancel mid-flight.
   */
  fetchSnapshot: (signal: AbortSignal) => Promise<T>;
  /** How long a cached snapshot is allowed to serve as a live-fetch fallback. */
  cacheTtlMs: number;
  /** Sink for ok / cache-fallback / hard-fail events. */
  logger: Logger;
  /**
   * Maps a successful snapshot into its "cached" representation —
   * airspace/metar/taf flip `source: "cached"` and refresh `timestamp`.
   * Default is identity (snapshot passes through unchanged).
   */
  toCached?: (s: T) => T;
  /**
   * Extracts a one-line stats summary for the "ok" log line, e.g.
   * "11 reports". Optional — omitted when null/undefined.
   */
  formatStats?: (s: T) => string | null;
}

export interface SnapshotPoller<T> {
  /** Begin polling on `intervalMs`. Idempotent — calling again replaces the interval. */
  start(intervalMs: number): void;
  /** Stop the interval and abort any in-flight fetch. */
  stop(): void;
  /** Trigger one poll without waiting for the interval. Exported for tests + start(). */
  pollOnce(): Promise<void>;
  /** Most recently resolved snapshot. Null until the first successful poll OR if cache expired. */
  getCurrent(): T | null;
  /** Test-only escape hatches. Never call from production code. */
  __TEST_INTERNALS__: { reset(): void };
}

export function createSnapshotPoller<T>(config: SnapshotPollerConfig<T>): SnapshotPoller<T> {
  const { name, fetchSnapshot, cacheTtlMs, logger, toCached, formatStats } = config;

  let snapshot: T | null = null;
  let cached: { snapshot: T; cachedAt: number } | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  let abortController: AbortController | null = null;
  // Per-poll id rather than a bare boolean. A boolean has no owner: after
  // stop() releases it and a new poll starts, the *abandoned* poll's finally
  // would clear the guard while the new one is still running, letting the
  // next tick overlap and restoring exactly the defect this guard removes.
  // Only the poll that currently owns the slot may release it.
  let pollSeq = 0;
  let activePollId: number | null = null;

  async function pollOnce(): Promise<void> {
    // Skip rather than overlap (#140). Worst-case airspace poll is ~17s
    // (3 attempts x 5s timeout plus 2s of backoff) against an 8s interval, so
    // without this a slow upstream produces concurrent polls that:
    //   - orphan the previous AbortController, since the field is overwritten
    //     and stop() then aborts only the newest, leaving earlier fetches
    //     running and holding the event loop open
    //   - write out of order, letting an older snapshot overwrite a newer one
    //     and then stamp it with a fresh cachedAt — serving stale data as live
    //   - double the request rate against the upstream exactly during an
    //     incident, contradicting this poller's own rate-limit etiquette
    if (activePollId !== null) {
      logger.warn("poll skipped, previous still in flight", { poller: name });
      return;
    }
    const pollId = ++pollSeq;
    activePollId = pollId;

    abortController = new AbortController();
    const signal = abortController.signal;
    const startTime = Date.now();

    try {
      const next = await fetchSnapshot(signal);
      snapshot = next;
      cached = { snapshot: next, cachedAt: Date.now() };
      const stats = formatStats?.(next);
      logger.info("poll ok", {
        poller: name,
        durationMs: Date.now() - startTime,
        ...(stats ? { stats } : {}),
      });
    } catch (err) {
      if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
        const cacheAgeMs = Date.now() - cached.cachedAt;
        snapshot = toCached ? toCached(cached.snapshot) : cached.snapshot;
        logger.warn("cache fallback", { poller: name, err, cacheAgeMs });
      } else {
        snapshot = null;
        cached = null;
        logger.warn("poll failed, no cache", { poller: name, err });
      }
    } finally {
      // Only release if we still own the slot — an abandoned poll settling
      // after stop()/restart must not unblock the poll that replaced it.
      if (activePollId === pollId) activePollId = null;
    }
  }

  return {
    start(intervalMs: number) {
      if (interval) clearInterval(interval);
      void pollOnce();
      interval = setInterval(() => void pollOnce(), intervalMs);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      abortController?.abort(new Error("poller stopped"));
      // Release the slot: the in-flight poll is being aborted, and a
      // subsequent start() must not be blocked by its pending rejection.
      // The abandoned poll's finally is now a no-op, since it no longer
      // owns the token.
      activePollId = null;
    },
    pollOnce,
    getCurrent: () => snapshot,
    __TEST_INTERNALS__: {
      reset() {
        snapshot = null;
        cached = null;
      },
    },
  };
}
