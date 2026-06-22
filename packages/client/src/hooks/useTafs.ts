import type { TafsResponse } from "@panoptrain/shared";
import { fetchTafs } from "../lib/api.js";
import { useBulkPollingEndpoint } from "./useBulkPollingEndpoint.js";

// TAFs amend mid-cycle but the base period changes only every 6 hours.
// 10 minutes is a comfortable middle ground — fresh enough to surface
// amendments soon after they're published, slow enough to not waste
// server cycles when nothing's changed.
const POLL_INTERVAL_MS = 10 * 60 * 1000;
const INITIAL_REPORTS: TafsResponse["reports"] = {};

interface UseTafsResult {
  /** Map keyed by ICAO ("KJFK"). Empty until the first poll lands. */
  reports: TafsResponse["reports"];
  source: "live" | "cached" | null;
  error: Error | null;
}

/**
 * Polls /api/airspace/taf at a slow cadence and exposes the parsed
 * report map. Single bulk request for all airports — the popup looks
 * up by ICAO. The 503 path (poller hasn't produced a snapshot yet) is
 * treated as "no reports yet" rather than an error so the popup can
 * render the rest of the briefing without weather instead of showing
 * a failure state during cold boot.
 *
 * `inFlightGuard: true` — TAF payload is ~25KB so a slow response could
 * overlap a fresh interval tick, and a stale older response landing
 * after a newer one would clobber fresh data.
 */
export function useTafs(enabled: boolean): UseTafsResult {
  const { data, source, error } = useBulkPollingEndpoint<TafsResponse["reports"]>({
    fetch: async () => {
      const res = await fetchTafs();
      return { data: res.reports, source: res.source };
    },
    initialData: INITIAL_REPORTS,
    intervalMs: POLL_INTERVAL_MS,
    inFlightGuard: true,
    enabled,
  });
  return { reports: data, source, error };
}
