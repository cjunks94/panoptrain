import type { MetarsResponse } from "@panoptrain/shared";
import { fetchMetars } from "../lib/api.js";
import { useBulkPollingEndpoint } from "./useBulkPollingEndpoint.js";

// METARs only update hourly so polling faster wastes server cycles.
// 5 minutes is well below the observation cadence — fresh enough that
// SPECI reports surface within a single polling window.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_REPORTS: MetarsResponse["reports"] = {};

interface UseMetarsResult {
  /** Map keyed by ICAO ("KJFK"). Empty until the first poll lands. */
  reports: MetarsResponse["reports"];
  source: "live" | "cached" | null;
  error: Error | null;
}

/**
 * Polls /api/airspace/metar at a slow cadence and exposes the parsed
 * report map. Single bulk request for all airports — payload is tiny
 * (~5KB) and the popup looks up by ICAO. The 503 path (poller hasn't
 * produced a snapshot yet) is treated as "no reports yet" rather than
 * an error so the popup can render without weather instead of showing
 * a failure state during cold boot.
 */
export function useMetars(enabled: boolean): UseMetarsResult {
  const { data, source, error } = useBulkPollingEndpoint<MetarsResponse["reports"]>({
    fetch: async () => {
      const res = await fetchMetars();
      return { data: res.reports, source: res.source };
    },
    initialData: INITIAL_REPORTS,
    intervalMs: POLL_INTERVAL_MS,
    enabled,
  });
  return { reports: data, source, error };
}
