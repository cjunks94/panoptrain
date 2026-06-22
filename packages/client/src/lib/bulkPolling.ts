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

export function createBulkPoller<TData>(config: CreateBulkPollerConfig<TData>): BulkPoller {
  const { fetch: fetchFn, initialData, intervalMs, inFlightGuard = false, onState } = config;

  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let inFlight = false;
  // Track current data so non-503 errors can preserve the last good value
  // — popups stay populated with stale-but-useful data while we surface
  // the error separately. 503 (cold start) resets to initialData.
  let currentData: TData = initialData;
  let currentSource: "live" | "cached" | null = null;

  async function pollOnce(): Promise<void> {
    if (stopped) return;
    if (inFlightGuard && inFlight) return;
    inFlight = true;
    try {
      const res = await fetchFn();
      if (stopped) return;
      currentData = res.data;
      currentSource = res.source;
      onState({ data: currentData, source: currentSource, error: null });
    } catch (err) {
      if (stopped) return;
      if (isTransientNoSnapshotError(err)) {
        currentData = initialData;
        currentSource = null;
        onState({ data: currentData, source: currentSource, error: null });
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        onState({ data: currentData, source: currentSource, error });
      }
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      stopped = false;
      void pollOnce();
      interval = setInterval(() => void pollOnce(), intervalMs);
    },
    stop() {
      stopped = true;
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
    },
  };
}
