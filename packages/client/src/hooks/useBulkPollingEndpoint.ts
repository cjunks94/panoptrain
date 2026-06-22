import { useEffect, useRef, useState } from "react";
import { createBulkPoller, type PollingState } from "../lib/bulkPolling.js";

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

export function useBulkPollingEndpoint<TData>(opts: UseBulkPollingOptions<TData>): UseBulkPollingResult<TData> {
  const { fetch: fetchFn, initialData, intervalMs, inFlightGuard, enabled } = opts;

  const [state, setState] = useState<PollingState<TData>>({
    data: initialData,
    source: null,
    error: null,
  });

  // The fetch closure may capture fresh callsite values each render; route
  // through a ref so we don't tear down the poller on every render.
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  // initialData is captured on first render and held stable for the hook's
  // lifetime — useRef's argument is ignored after first render.
  const initialDataRef = useRef(initialData);

  useEffect(() => {
    if (!enabled) {
      setState({ data: initialDataRef.current, source: null, error: null });
      return;
    }
    const poller = createBulkPoller<TData>({
      fetch: () => fetchRef.current(),
      initialData: initialDataRef.current,
      intervalMs,
      inFlightGuard,
      onState: setState,
    });
    poller.start();
    return () => poller.stop();
  }, [enabled, intervalMs, inFlightGuard]);

  return state;
}
