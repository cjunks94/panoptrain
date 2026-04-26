import { useState, useEffect, useRef, useCallback } from "react";
import type { TrainsResponse } from "@panoptrain/shared";
import { fetchTrains } from "../lib/api.js";

// Injected by vite.config.ts from the repo-root POLL_INTERVAL_MS env var so
// this stays in lockstep with the server's polling cadence.
const POLL_INTERVAL = parseInt(import.meta.env.VITE_POLL_INTERVAL_MS ?? "30000", 10);
const STALE_THRESHOLD = 90_000; // 90 seconds

interface UseTrainPositionsResult {
  data: TrainsResponse | null;
  isStale: boolean;
  lastUpdated: number | null;
  error: Error | null;
}

export function useTrainPositions(): UseTrainPositionsResult {
  const [data, setData] = useState<TrainsResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    // Skip the network round-trip when the tab isn't visible — the user
    // can't see the trains anyway, and we'll grab fresh data the moment
    // they switch back. Saves bandwidth and battery on long-idle tabs.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    try {
      const result = await fetchTrains();
      setData(result);
      setLastUpdated(Date.now());
      setIsStale(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  // When the tab becomes visible again, immediately refresh so users don't
  // see stale positions while waiting for the next interval tick (PT-105).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisChange = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [poll]);

  // Check staleness
  useEffect(() => {
    const check = setInterval(() => {
      if (lastUpdated && Date.now() - lastUpdated > STALE_THRESHOLD) {
        setIsStale(true);
      }
    }, 5000);
    return () => clearInterval(check);
  }, [lastUpdated]);

  return { data, isStale, lastUpdated, error };
}
