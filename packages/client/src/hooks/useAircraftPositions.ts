import type { Aircraft } from "@panoptrain/shared";
import { fetchAirspaceAircraft } from "../lib/api.js";
import { useBulkPollingEndpoint } from "./useBulkPollingEndpoint.js";

// Matches the server's poll cadence + Cache-Control: max-age=5. Polling
// faster won't get fresher data; polling much slower makes plane motion
// look teleported (a 450kt jet covers ~1.85km in 8s).
const POLL_INTERVAL = 8_000;
const INITIAL_AIRCRAFT: Aircraft[] = [];

interface UseAircraftPositionsResult {
  aircraft: Aircraft[];
  source: "live" | "cached" | null;
  error: Error | null;
}

/**
 * Polls /api/airspace/aircraft when `enabled` is true; clears state to
 * empty when toggled off. The server returns 503 cleanly when its own
 * upstream poller hasn't produced a snapshot yet — we surface that as
 * an empty array rather than an error since it's a normal startup
 * state, not a user-actionable failure.
 */
export function useAircraftPositions(enabled: boolean): UseAircraftPositionsResult {
  const { data, source, error } = useBulkPollingEndpoint<Aircraft[]>({
    fetch: async () => {
      const res = await fetchAirspaceAircraft();
      return { data: res.aircraft, source: res.source };
    },
    initialData: INITIAL_AIRCRAFT,
    intervalMs: POLL_INTERVAL,
    enabled,
  });
  return { aircraft: data, source, error };
}
