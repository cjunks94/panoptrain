import { useState, useEffect } from "react";
import type { Aircraft } from "@panoptrain/shared";
import { fetchAirspaceAircraft } from "../lib/api.js";

// Matches the server's poll cadence + Cache-Control: max-age=5. Polling
// faster won't get fresher data; polling much slower makes plane motion
// look teleported (a 450kt jet covers ~1.85km in 8s).
const POLL_INTERVAL = 8_000;

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
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [source, setSource] = useState<"live" | "cached" | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setAircraft([]);
      setSource(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchAirspaceAircraft();
        if (cancelled) return;
        setAircraft(res.aircraft);
        setSource(res.source);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // 503 = poller hasn't produced a snapshot yet (e.g., adsb.lol is
        // down or the server just started). Treat as transient empty
        // rather than a hard error so the toggle stays usable.
        if (msg.startsWith("API 503")) {
          setAircraft([]);
          setSource(null);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err : new Error(msg));
      }
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { aircraft, source, error };
}
