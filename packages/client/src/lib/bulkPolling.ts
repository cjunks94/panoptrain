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

export function createBulkPoller<TData>(_config: CreateBulkPollerConfig<TData>): BulkPoller {
  throw new Error("Not implemented");
}
