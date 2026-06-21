import type { PollingState } from "../lib/bulkPolling.js";

/**
 * React adapter for `createBulkPoller`. Owns the React state + useEffect
 * lifecycle binding; the polling logic itself lives in `lib/bulkPolling.ts`
 * (pure, separately tested).
 */
export interface UseBulkPollingOptions<TData> {
  fetch: () => Promise<{ data: TData; source: "live" | "cached" }>;
  initialData: TData;
  intervalMs: number;
  /** Opt in to skip-when-overlapping behavior. See `bulkPolling.ts`. */
  inFlightGuard?: boolean;
  /** When false, the hook is dormant and state resets to `initialData`. */
  enabled: boolean;
}

export type UseBulkPollingResult<TData> = PollingState<TData>;

export function useBulkPollingEndpoint<TData>(_opts: UseBulkPollingOptions<TData>): UseBulkPollingResult<TData> {
  throw new Error("Not implemented");
}
