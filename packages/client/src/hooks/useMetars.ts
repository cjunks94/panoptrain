import { useEffect, useState } from "react";
import type { MetarsResponse } from "@panoptrain/shared";
import { fetchMetars } from "../lib/api.js";

// METARs only update hourly so polling faster wastes server cycles.
// 5 minutes is well below the observation cadence — fresh enough that
// SPECI reports surface within a single polling window.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

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
  const [reports, setReports] = useState<MetarsResponse["reports"]>({});
  const [source, setSource] = useState<"live" | "cached" | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReports({});
      setSource(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchMetars();
        if (cancelled) return;
        setReports(res.reports);
        setSource(res.source);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("API 503")) {
          // Poller hasn't run yet (server just started). Surface as
          // "no reports" rather than an error — the popup falls back
          // to its non-weather rows cleanly.
          setReports({});
          setSource(null);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err : new Error(msg));
      }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { reports, source, error };
}
