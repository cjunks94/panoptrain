import nearestPointOnLine from "@turf/nearest-point-on-line";
import along from "@turf/along";
import turfLength from "@turf/length";
import { lineString } from "@turf/helpers";
import type { RoutesGeoJSON } from "@panoptrain/shared";

interface ShapeData {
  line: ReturnType<typeof lineString>;
  totalLength: number;
  id: number; // unique index for cache keying
}

export interface TrackPath {
  shape: ShapeData;
  startDist: number;
  endDist: number;
}

// Cache nearestPointOnLine results — trains follow repeatable routes,
// so the same position on the same shape yields the same distance.
// Key: "shapeId:roundedLon,roundedLat" → distance along shape
const snapCache = new Map<string, number>();
const SNAP_GRID = 0.0001; // ~11m resolution — fine enough for smooth animation
const MAX_CACHE_SIZE = 5000;

function cachedSnap(shape: ShapeData, pos: [number, number]): number {
  const key = `${shape.id}:${Math.round(pos[0] / SNAP_GRID)},${Math.round(pos[1] / SNAP_GRID)}`;
  const cached = snapCache.get(key);
  if (cached !== undefined) return cached;

  const snap = nearestPointOnLine(shape.line, pos);
  const dist = snap.properties.location ?? 0;

  // Evict oldest entries if cache is full
  if (snapCache.size >= MAX_CACHE_SIZE) {
    const first = snapCache.keys().next().value!;
    snapCache.delete(first);
  }
  snapCache.set(key, dist);
  return dist;
}

// Cache which shape is best for a given route + position grid cell
const bestShapeCache = new Map<string, ShapeData | null>();

function cachedBestShape(
  shapes: ShapeData[],
  routeId: string,
  pos: [number, number],
): { shape: ShapeData | null; tooFar: boolean } {
  const key = `${routeId}:${Math.round(pos[0] / SNAP_GRID)},${Math.round(pos[1] / SNAP_GRID)}`;
  if (bestShapeCache.has(key)) {
    return { shape: bestShapeCache.get(key)!, tooFar: false };
  }

  let best: ShapeData | null = null;
  let bestDist = Infinity;
  for (const shape of shapes) {
    const snap = nearestPointOnLine(shape.line, pos);
    const dist = snap.properties.dist ?? Infinity;
    if (dist < bestDist) {
      bestDist = dist;
      best = shape;
    }
  }

  const result = bestDist <= 0.5 ? best : null; // > 500m → no match
  if (bestShapeCache.size >= MAX_CACHE_SIZE) {
    const first = bestShapeCache.keys().next().value!;
    bestShapeCache.delete(first);
  }
  bestShapeCache.set(key, result);
  return { shape: result, tooFar: bestDist > 0.5 };
}

/**
 * Index route shapes by routeId for quick lookup.
 * Each route may have multiple shapes (directions/branches).
 */
export function buildShapeIndex(routes: RoutesGeoJSON): Record<string, ShapeData[]> {
  const index: Record<string, ShapeData[]> = {};
  let shapeId = 0;
  for (const feature of routes.features) {
    const routeId = feature.properties.routeId;
    if (!index[routeId]) index[routeId] = [];
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;
    const line = lineString(coords);
    index[routeId].push({ line, totalLength: turfLength(line), id: shapeId++ });
  }
  // Clear caches when shapes change
  snapCache.clear();
  bestShapeCache.clear();
  return index;
}

/**
 * Find the track path between two positions on a route's shape.
 * Returns the shape and start/end distances, or null if no shape matches.
 */
export function findTrackPath(
  shapeIndex: Record<string, ShapeData[]>,
  routeId: string,
  prevPos: [number, number],
  currPos: [number, number],
): TrackPath | null {
  const shapes = shapeIndex[routeId];
  if (!shapes || shapes.length === 0) return null;

  const { shape, tooFar } = cachedBestShape(shapes, routeId, currPos);
  if (!shape || tooFar) return null;

  const startDist = cachedSnap(shape, prevPos);
  const endDist = cachedSnap(shape, currPos);

  return { shape, startDist, endDist };
}

/**
 * Interpolate a position along a track path at a given fraction.
 */
export function interpolateAlongPath(
  path: TrackPath,
  fraction: number,
): [number, number] {
  const dist = path.startDist + (path.endDist - path.startDist) * fraction;
  const clamped = Math.max(0, Math.min(path.shape.totalLength, dist));
  const pt = along(path.shape.line, clamped);
  return pt.geometry.coordinates as [number, number];
}
