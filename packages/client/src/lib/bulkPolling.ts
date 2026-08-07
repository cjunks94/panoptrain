/**
 * Shared polling state machine extracted from useMetars / useTafs /
 * useAircraftPositions (#87). The three hooks reimplemented near-
 * identical "fetch on interval, treat API 503 as cold-start" logic with
 * subtle drift in inFlight handling.
 *
 * This module is pure (no React) so the state machine is testable
 * without a DOM renderer. `useBulkPollingEndpoint` wraps it for React.
 *
 * Mirrors the server-side `services/base-poller.ts` factory pattern
 * landed in #85 — same shape applied to the client.
 */

export interface PollingState<TData> {
  data: TData;
  source: "live" | "cached" | null;
  error: Error | null;
}

export interface CreateBulkPollerConfig<TData> {
  /** Domain-adapted fetch. Caller maps API response → `{ data, source }`. */
  fetch: () => Promise<{ data: TData; source: "live" | "cached" }>;
  /** Returned in state when the poller hasn't successfully fetched yet OR on a 503. */
  initialData: TData;
  /** Interval between poll ticks (ms). */
  intervalMs: number;
  /**
   * When true, skip a tick if a previous fetch is still in flight.
   * Prevents stale older responses from clobbering fresh newer ones on
   * slow networks. Default false — small/fast endpoints don't need it.
   */
  inFlightGuard?: boolean;
  /** Called after each poll resolves or rejects with the new state. */
  onState: (state: PollingState<TData>) => void;
}

export interface BulkPoller {
  /** Begin polling. Triggers an immediate first poll, then schedules interval. */
  start(): void;
  /** Stop the interval. Already-pending fetch results are dropped (onState not called). */
  stop(): void;
}

/**
 * Detects the cold-start path where the server's upstream poller hasn't
 * produced a snapshot yet. The server's `fetchJson` formats these errors
 * as "API 503: <body>" — see `client/src/lib/api.ts`.
 */
export function isTransientNoSnapshotError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith("API 503");
}

/** Cap on exponential backoff. Long enough to stop hammering a down server,
 *  short enough that recovery is noticed without a reload. */
export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function createBulkPoller<TData>(config: CreateBulkPollerConfig<TData>): BulkPoller {
  const { fetch: fetchFn, initialData, intervalMs, inFlightGuard = false, onState } = config;

  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let inFlight = false;
  // Monotonic request id. `inFlightGuard` prevents overlap only when it is
  // enabled, and even then a tick can start the moment the previous fetch
  // settles — so ordering still has to be enforced on the apply side. Without
  // this an older response can land after a newer one and clobber it, which
  // shows up as markers jumping backwards (#132).
  let nextSeq = 0;
  let lastAppliedSeq = -1;
  // Consecutive failures, for exponential backoff (#133). Reset on success.
  let failures = 0;
  let backoffTimer: ReturnType<typeof setTimeout> | undefined;
  // Track current data so non-503 errors can preserve the last good value
  // — popups stay populated with stale-but-useful data while we surface
  // the error separately. 503 (cold start) resets to initialData.
  let currentData: TData = initialData;
  let currentSource: "live" | "cached" | null = null;

  /** Backoff delay for the Nth consecutive failure: interval * 2^(n-1),
   *  capped. Returns 0 while healthy so the normal interval is unchanged. */
  function backoffFor(consecutiveFailures: number): number {
    if (consecutiveFailures <= 0) return 0;
    const grown = intervalMs * 2 ** (consecutiveFailures - 1);
    return Math.min(grown, MAX_BACKOFF_MS);
  }

  /** After a failure, pause the steady interval and resume it once the
   *  backoff elapses. Keeps a dead server from being polled at full cadence
   *  indefinitely, while recovering on its own without a reload. */
  function scheduleBackoff(): void {
    if (stopped) return;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => {
      if (stopped) return;
      void pollOnce();
      if (!interval && !stopped) interval = setInterval(() => void pollOnce(), intervalMs);
    }, backoffFor(failures));
  }

  function resumeSteadyInterval(): void {
    clearTimeout(backoffTimer);
    backoffTimer = undefined;
    if (!interval && !stopped) interval = setInterval(() => void pollOnce(), intervalMs);
  }

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    if (inFlightGuard && inFlight) return;
    inFlight = true;
    const seq = nextSeq++;
    try {
      const res = await fetchFn();
      if (stopped) return;
      // Drop a response that resolved out of order — a slower earlier
      // request must never overwrite a newer snapshot.
      if (seq < lastAppliedSeq) return;
      lastAppliedSeq = seq;
      failures = 0;
      resumeSteadyInterval();
      currentData = res.data;
      currentSource = res.source;
      onState({ data: currentData, source: currentSource, error: null });
    } catch (err) {
      if (stopped) return;
      if (seq < lastAppliedSeq) return;
      lastAppliedSeq = seq;
      if (isTransientNoSnapshotError(err)) {
        // Cold start is expected, not a failure — don't back off, the
        // server is up and about to have data.
        failures = 0;
        resumeSteadyInterval();
        currentData = initialData;
        currentSource = null;
        onState({ data: currentData, source: currentSource, error: null });
      } else {
        failures++;
        const error = err instanceof Error ? err : new Error(String(err));
        onState({ data: currentData, source: currentSource, error });
        scheduleBackoff();
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      stopped = false;
      failures = 0;
      void pollOnce();
      interval = setInterval(() => void pollOnce(), intervalMs);
    },
    stop() {
      stopped = true;
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      clearTimeout(backoffTimer);
      backoffTimer = undefined;
    },
  };
}
