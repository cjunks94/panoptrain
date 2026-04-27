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

  // Start/stop the polling interval based on tab visibility (PT-105). When
  // hidden we tear the interval down completely (no idle timer firing every
  // 30s on a background tab); when visible we poll once immediately for fresh
  // data, then restart the interval so cadence is clean rather than racing
  // a partially-elapsed timer.
  useEffect(() => {
    const start = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      poll();
      intervalRef.current = setInterval(poll, POLL_INTERVAL);
    };
    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (isHidden) stop();
    else start();

    if (typeof document === "undefined") {
      return stop;
    }
    const onVisChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      stop();
    };
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
