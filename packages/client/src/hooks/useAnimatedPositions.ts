import { useState, useEffect, useRef, useCallback } from "react";
import type { TrainsResponse, TrainPosition } from "@panoptrain/shared";
import { getRouteInfo } from "../lib/colors.js";

const POLL_INTERVAL = parseInt(import.meta.env.VITE_POLL_INTERVAL_MS ?? "15000", 10);
const FRAME_INTERVAL = 66; // ~15fps — smooth enough for moving dots, 4x less GC pressure

export interface AnimatedTrain extends TrainPosition {
  color: string;
  textColor: string;
  isExpress: boolean;
}

/**
 * Interpolates train positions between server poll snapshots.
 * Throttled to ~15fps to avoid GC thrashing from 60fps React state updates.
 */
export function useAnimatedPositions(data: TrainsResponse | null): AnimatedTrain[] {
  const prevSnapshot = useRef<TrainPosition[]>([]);
  const currSnapshot = useRef<TrainPosition[]>([]);
  const snapshotTime = useRef<number>(0);
  const [animated, setAnimated] = useState<AnimatedTrain[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameTime = useRef<number>(0);

  // When new data arrives, shift snapshots
  useEffect(() => {
    if (!data) return;
    prevSnapshot.current = currSnapshot.current;
    currSnapshot.current = data.trains;
    snapshotTime.current = Date.now();
  }, [data]);

  const animate = useCallback(() => {
    const now = Date.now();

    // Throttle: skip frame if less than FRAME_INTERVAL since last render
    if (now - lastFrameTime.current >= FRAME_INTERVAL) {
      lastFrameTime.current = now;
      const elapsed = now - snapshotTime.current;
      const fraction = Math.min(elapsed / POLL_INTERVAL, 1);

      const prev = prevSnapshot.current;
      const curr = currSnapshot.current;

      // Build prev lookup only if we have previous data
      let prevMap: Map<string, TrainPosition> | null = null;
      if (prev.length > 0 && fraction < 1) {
        prevMap = new Map();
        for (const t of prev) prevMap.set(t.tripId, t);
      }

      const result: AnimatedTrain[] = new Array(curr.length);
      for (let i = 0; i < curr.length; i++) {
        const train = curr[i];
        let lat = train.latitude;
        let lon = train.longitude;

        if (prevMap) {
          const p = prevMap.get(train.tripId);
          if (p) {
            lat = p.latitude + (train.latitude - p.latitude) * fraction;
            lon = p.longitude + (train.longitude - p.longitude) * fraction;
          }
        }

        const info = getRouteInfo(train.routeId);
        result[i] = {
          tripId: train.tripId,
          routeId: train.routeId,
          direction: train.direction,
          latitude: lat,
          longitude: lon,
          bearing: train.bearing,
          status: train.status,
          currentStopId: train.currentStopId,
          currentStopName: train.currentStopName,
          nextStopId: train.nextStopId,
          nextStopName: train.nextStopName,
          destination: train.destination,
          delay: train.delay,
          updatedAt: train.updatedAt,
          color: info.color,
          textColor: info.textColor,
          isExpress: info.isExpress,
        };
      }

      setAnimated(result);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  return animated;
}
