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

export async function fetchWithRetry<T>(_opts: FetchWithRetryOptions<T>): Promise<T> {
  throw new Error("Not implemented");
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

export function createSnapshotPoller<T>(_config: SnapshotPollerConfig<T>): SnapshotPoller<T> {
  throw new Error("Not implemented");
}
