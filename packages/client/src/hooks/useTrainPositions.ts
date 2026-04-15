import { useState, useEffect, useRef, useCallback } from "react";
import type { TrainsResponse } from "@panoptrain/shared";
import { fetchTrains } from "../lib/api.js";

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

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
