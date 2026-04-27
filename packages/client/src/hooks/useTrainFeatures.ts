import { useState, useEffect, useRef, useCallback } from "react";
import type { Mode, TrainsResponse, TrainPosition, RoutesGeoJSON } from "@panoptrain/shared";
import { getRouteInfo } from "../lib/colors.js";
import { buildShapeIndex, findTrackPath, interpolateAlongPath } from "../lib/trackInterpolation.js";
import type { TrackPath } from "../lib/trackInterpolation.js";

const POLL_INTERVAL = parseInt(import.meta.env.VITE_POLL_INTERVAL_MS ?? "30000", 10);

export interface TrainInfo extends TrainPosition {
  color: string;
  textColor: string;
  /** Bullet text — "1" for subway, "BB" / "PJ" / etc. for LIRR branches. */
  label: string;
  /** SDF icon name the marker layer should render. */
  iconImage: "marker-circle" | "marker-square";
}

interface FeatureProps {
  tripId: string;
  routeId: string;
  color: string;
  textColor: string;
  label: string;
  iconImage: "marker-circle" | "marker-square";
  direction: number;
  bearing: number;
  status: string;
  destination: string;
  currentStopName: string;
  nextStopName: string;
  delay: number;
  clusterOffset: number;
  opacity: number;
}

interface TrainFeature {
  type: "Feature";
  properties: FeatureProps;
  geometry: { type: "Point"; coordinates: [number, number] };
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Builds train GeoJSON features once per data/filter change.
 * Exposes an interpolateFrame() function that mutates coordinates in-place
 * for the RAF loop — no React state updates during animation.
 *
 * When `planRouteIds` is non-null, trains whose routeId is NOT in that set
 * are filtered out entirely so only the trains relevant to the active plan
 * remain on the map (PT-309 focus mode).
 */
export function useTrainFeatures(
  data: TrainsResponse | null,
  visibleRoutes: Set<string>,
  routeShapes: RoutesGeoJSON | null,
  planRouteIds: Set<string> | null = null,
  mode: Mode = "subway",
) {
  const geojsonRef = useRef(EMPTY_FC);
  const prevPositions = useRef(new Map<string, [number, number]>());
  const currPositions = useRef(new Map<string, [number, number]>());
  const trackPaths = useRef(new Map<string, TrackPath>());
  const snapshotTime = useRef(0);
  const lastDataRef = useRef<TrainsResponse | null>(null);
  const shapeIndexRef = useRef<Record<string, ReturnType<typeof buildShapeIndex>[string]>>({});
  const [trains, setTrains] = useState<TrainInfo[]>([]);

  // Build shape index once when route shapes load
  useEffect(() => {
    if (!routeShapes) return;
    shapeIndexRef.current = buildShapeIndex(routeShapes);
  }, [routeShapes]);

  // Shift position snapshots when new data arrives (fast — no heavy computation)
  useEffect(() => {
    if (!data || data === lastDataRef.current) return;
    lastDataRef.current = data;
    prevPositions.current = currPositions.current;
    const positions = new Map<string, [number, number]>();
    for (const t of data.trains) {
      positions.set(t.tripId, [t.longitude, t.latitude]);
    }
    currPositions.current = positions;
    snapshotTime.current = Date.now();

    // Defer track path computation off the main thread.
    // First animation frames use linear interpolation; paths are ready by ~next frame.
    const MIN_DIST_SQ = 0.002 * 0.002; // ~200m in degrees
    const trainsToProcess = data.trains;
    const prev = prevPositions.current;
    const index = shapeIndexRef.current;

    const tid = setTimeout(() => {
      const paths = new Map<string, TrackPath>();
      if (Object.keys(index).length > 0) {
        for (const t of trainsToProcess) {
          const p = prev.get(t.tripId);
          if (!p) continue;
          const dx = t.longitude - p[0];
          const dy = t.latitude - p[1];
          if (dx * dx + dy * dy < MIN_DIST_SQ) continue;
          const path = findTrackPath(index, t.routeId, p, [t.longitude, t.latitude]);
          if (path) paths.set(t.tripId, path);
        }
      }
      trackPaths.current = paths;
    }, 0);

    return () => clearTimeout(tid);
  }, [data]);

  // Rebuild features when data or visibleRoutes change
  useEffect(() => {
    const d = lastDataRef.current;
    if (!d) return;

    const visible = d.trains.filter((t) =>
      visibleRoutes.has(t.routeId) && (!planRouteIds || planRouteIds.has(t.routeId)),
    );

    // Deduplicate: within ~50m grid, keep one train per route
    const DEDUP_GRID = 0.0005;
    const seenRouteAtGrid = new Set<string>();
    const deduped = visible.filter((t) => {
      const gx = Math.round(t.longitude / DEDUP_GRID);
      const gy = Math.round(t.latitude / DEDUP_GRID);
      const key = `${gx},${gy}-${t.routeId}`;
      if (seenRouteAtGrid.has(key)) return false;
      seenRouteAtGrid.add(key);
      return true;
    });

    // Compute freshness-based opacity
    const nowSec = Math.floor(Date.now() / 1000);
    const FRESH = 120;
    const STALE = 300;

    const features: TrainFeature[] = deduped.map((t) => {
      const age = nowSec - t.updatedAt;
      const opacity = age <= FRESH ? 1
        : age >= STALE ? 0.35
        : 1 - 0.65 * ((age - FRESH) / (STALE - FRESH));
      const info = getRouteInfo(t.routeId, mode);

      return {
        type: "Feature",
        properties: {
          tripId: t.tripId,
          routeId: t.routeId,
          color: info.color,
          textColor: info.textColor,
          label: info.label,
          iconImage: info.markerShape === "square" ? "marker-square" : "marker-circle",
          direction: t.direction,
          bearing: t.bearing ?? (t.direction === 0 ? 0 : 180),
          status: t.status,
          destination: t.destination,
          currentStopName: t.currentStopName,
          nextStopName: t.nextStopName ?? "",
          delay: t.delay ?? 0,
          clusterOffset: 0,
          opacity: Math.round(opacity * 100) / 100,
        },
        geometry: {
          type: "Point",
          coordinates: [t.longitude, t.latitude],
        },
      };
    });

    // Detect overlaps and assign horizontal fan-out offsets
    const GRID = 0.0005;
    const groups: Record<string, number[]> = {};
    for (let i = 0; i < features.length; i++) {
      const [lon, lat] = features[i].geometry.coordinates;
      const key = `${Math.round(lon / GRID)},${Math.round(lat / GRID)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(i);
    }
    for (const indices of Object.values(groups)) {
      if (indices.length <= 1) continue;
      const center = (indices.length - 1) / 2;
      for (let j = 0; j < indices.length; j++) {
        features[indices[j]].properties.clusterOffset = j - center;
      }
    }

    geojsonRef.current = { type: "FeatureCollection", features };

    // Update popup-lookup trains (triggers one React render)
    setTrains(deduped.map((t) => {
      const info = getRouteInfo(t.routeId, mode);
      return {
        ...t,
        color: info.color,
        textColor: info.textColor,
        label: info.label,
        iconImage: info.markerShape === "square" ? "marker-square" : "marker-circle" as const,
      };
    }));
  }, [data, visibleRoutes, planRouteIds, mode]);

  // Mutate GeoJSON coordinates in-place for animation — called by RAF loop
  const interpolateFrame = useCallback(() => {
    const elapsed = Date.now() - snapshotTime.current;
    const fraction = Math.min(elapsed / POLL_INTERVAL, 1);
    const prev = prevPositions.current;
    const curr = currPositions.current;
    const paths = trackPaths.current;
    const features = geojsonRef.current.features as TrainFeature[];

    for (let i = 0; i < features.length; i++) {
      const tripId = features[i].properties.tripId;
      const c = curr.get(tripId);
      if (!c) continue;

      if (fraction >= 1) {
        features[i].geometry.coordinates[0] = c[0];
        features[i].geometry.coordinates[1] = c[1];
        continue;
      }

      const p = prev.get(tripId);
      if (!p) {
        features[i].geometry.coordinates[0] = c[0];
        features[i].geometry.coordinates[1] = c[1];
        continue;
      }

      // Use track path for on-rail animation, fall back to linear interpolation
      const path = paths.get(tripId);
      if (path) {
        const pos = interpolateAlongPath(path, fraction);
        features[i].geometry.coordinates[0] = pos[0];
        features[i].geometry.coordinates[1] = pos[1];
      } else {
        features[i].geometry.coordinates[0] = p[0] + (c[0] - p[0]) * fraction;
        features[i].geometry.coordinates[1] = p[1] + (c[1] - p[1]) * fraction;
      }
    }
  }, []);

  return { geojsonRef, interpolateFrame, trains };
}
