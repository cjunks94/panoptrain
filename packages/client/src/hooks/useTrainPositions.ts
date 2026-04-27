import { useState, useEffect, useRef, useCallback } from "react";
import type { Mode, TrainsResponse } from "@panoptrain/shared";
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

export function useTrainPositions(mode: Mode): UseTrainPositionsResult {
  const [data, setData] = useState<TrainsResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the current mode so an in-flight poll can detect a mode flip
  // happening between fetch start and resolve, and discard its response.
  // Without this, switching Subway → LIRR while a /api/subway/trains request
  // is mid-flight would briefly flash subway trains in the LIRR view.
  const modeRef = useRef(mode);

  // Clear stale data when the mode flips so we don't briefly show subway
  // trains while the LIRR fetch is in flight, and update modeRef.
  useEffect(() => {
    modeRef.current = mode;
    setData(null);
    setLastUpdated(null);
    setIsStale(false);
  }, [mode]);

  const poll = useCallback(async () => {
    const requested = mode;
    try {
      const result = await fetchTrains(requested);
      if (modeRef.current !== requested) return; // mode flipped mid-flight
      setData(result);
      setLastUpdated(Date.now());
      setIsStale(false);
      setError(null);
    } catch (err) {
      if (modeRef.current !== requested) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [mode]);

  // Start/stop the polling interval based on tab visibility (PT-105). When
  // hidden we tear the interval down completely (no idle timer firing every
  // 30s on a background tab); when visible we poll once immediately for fresh
  // data, then restart the interval so cadence is clean rather than racing
  // a partially-elapsed timer.
  //
  // Mobile gotcha: iOS Safari fires `visibilitychange` inconsistently when
  // the user app-switches or pulls down notification center, and aggressively
  // throttles setInterval in the background. The result was the user
  // returning to a stale map with frozen trains. Adding `pageshow`
  // (fires on bfcache restore — the most common iOS return path) and
  // `focus` as additional resume signals so any path back to the tab
  // triggers an immediate fresh fetch. start() is idempotent — calling it
  // multiple times just clears and restarts the interval.
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

    if (typeof document === "undefined" || typeof window === "undefined") {
      return stop;
    }
    const onVisChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    const onResume = () => {
      if (document.visibilityState !== "hidden") start();
    };
    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("focus", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("focus", onResume);
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
