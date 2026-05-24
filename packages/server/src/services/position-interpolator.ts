import along from "@turf/along";
import turfLength from "@turf/length";
import turfBearing from "@turf/bearing";
import { lineString, point } from "@turf/helpers";
import type { TrainPosition, ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";
import type { StaticGtfsData } from "./gtfs-loader.js";

/**
 * Pre-computed lookups, built once per StaticGtfsData object:
 * 1. route+direction -> ALL shapes (for branching routes like A/E)
 * 2. stopId -> which shapes contain it (for matching trains to correct branch)
 *
 * Keyed by gtfs identity via WeakMap so subway and LIRR each get their own
 * lookups. Without this, whichever mode polls first wins the module-level
 * tables and the other mode's trains get matched against the wrong shapes —
 * subway 1/2/3/... routeIds happen to overlap LIRR's numeric routeIds, so
 * subway trains end up "running on" LIRR rails and lettered routes (no LIRR
 * counterpart) get dropped entirely by `findBestShape`.
 */
interface RouteShape {
  shapeId: string;
  tripHeadsign: string;
  patternKey: string; // "routeId-directionId-shapeId"
}

interface Lookups {
  allRouteShapes: Map<string, RouteShape[]>;
  stopToShapes: Map<string, RouteShape[]>;
  crossRouteStopToShapes: Map<string, RouteShape[]>;
}

const lookupsByGtfs = new WeakMap<StaticGtfsData, Lookups>();

function getLookups(gtfs: StaticGtfsData): Lookups {
  const cached = lookupsByGtfs.get(gtfs);
  if (cached) return cached;

  const lk: Lookups = {
    allRouteShapes: new Map(),
    stopToShapes: new Map(),
    crossRouteStopToShapes: new Map(),
  };
  const seen = new Set<string>();

  for (const trip of Object.values(gtfs.trips)) {
    const routeKey = `${trip.routeId}-${trip.directionId}`;
    const shapeKey = `${routeKey}-${trip.shapeId}`;
    if (seen.has(shapeKey)) continue;
    seen.add(shapeKey);

    const rs: RouteShape = {
      shapeId: trip.shapeId,
      tripHeadsign: trip.tripHeadsign,
      patternKey: shapeKey,
    };

    if (!lk.allRouteShapes.has(routeKey)) lk.allRouteShapes.set(routeKey, []);
    lk.allRouteShapes.get(routeKey)!.push(rs);

    const dists = gtfs.stopDistances[trip.shapeId];
    if (dists) {
      for (const stopId of Object.keys(dists)) {
        const stopKey = `${trip.routeId}-${trip.directionId}-${stopId}`;
        if (!lk.stopToShapes.has(stopKey)) lk.stopToShapes.set(stopKey, []);
        lk.stopToShapes.get(stopKey)!.push(rs);

        const crossKey = `${trip.directionId}-${stopId}`;
        if (!lk.crossRouteStopToShapes.has(crossKey)) lk.crossRouteStopToShapes.set(crossKey, []);
        lk.crossRouteStopToShapes.get(crossKey)!.push(rs);
      }
    }
  }

  let totalShapes = 0;
  for (const shapes of lk.allRouteShapes.values()) totalShapes += shapes.length;
  console.log(`  Built route->shape lookup: ${lk.allRouteShapes.size} route+direction combos, ${totalShapes} total shapes`);

  lookupsByGtfs.set(gtfs, lk);
  return lk;
}

/**
 * Find the best matching shape for a train by checking which shape
 * contains the train's current stop. Falls back to the shape with the most stops.
 */
function findBestShape(
  routeId: string,
  directionId: number,
  stopId: string,
  gtfs: StaticGtfsData,
): RouteShape | null {
  const lk = getLookups(gtfs);

  // Pass 1: Exact route+stop match — handles normal operation and branching routes
  const stopKey = `${routeId}-${directionId}-${stopId}`;
  const byStop = lk.stopToShapes.get(stopKey);
  if (byStop && byStop.length > 0) return byStop[0];

  // Pass 2: Cross-route stop match — handles rerouted trains (e.g., 1 on A/C/E tracks)
  const crossKey = `${directionId}-${stopId}`;
  const byCrossStop = lk.crossRouteStopToShapes.get(crossKey);
  if (byCrossStop && byCrossStop.length > 0) return byCrossStop[0];

  // Pass 3: Any shape for this route+direction (last resort)
  const routeKey = `${routeId}-${directionId}`;
  const all = lk.allRouteShapes.get(routeKey);
  if (all && all.length > 0) return all[0];

  return null;
}

// Cache lineString + length computations per shape, keyed by gtfs identity
// so subway and LIRR don't collide on shape IDs (and so reloading static GTFS
// in tests doesn't serve stale geometries).
interface LineData { line: ReturnType<typeof lineString>; totalLength: number }
const lineCacheByGtfs = new WeakMap<StaticGtfsData, Map<string, LineData>>();

/** Pre-build the per-gtfs lookup indexes and line geometries so the first
 *  poll's `interpolatePositions` doesn't pay for ~20k trip indexing inline.
 *  Call once per mode at startup, after `loadStaticGtfs` and before
 *  `startPolling`. Idempotent (re-calls hit the cached results). */
export function prewarmInterpolator(gtfs: StaticGtfsData): void {
  const start = Date.now();
  getLookups(gtfs);
  for (const shapeId of Object.keys(gtfs.shapes)) {
    getLine(shapeId, gtfs);
  }
  console.log(`  Prewarmed interpolator caches in ${Date.now() - start}ms`);
}

/** Compute bearing at a given distance along a line by looking 50m in each direction */
function bearingAtDist(lineData: LineData, dist: number): number | null {
  const behind = Math.max(0, dist - 0.05);
  const ahead = Math.min(lineData.totalLength, dist + 0.05);
  if (ahead - behind < 0.001) return null;
  const ptA = along(lineData.line, behind);
  const ptB = along(lineData.line, ahead);
  return turfBearing(point(ptA.geometry.coordinates), point(ptB.geometry.coordinates));
}

function getLine(shapeId: string, gtfs: StaticGtfsData): LineData | null {
  let cache = lineCacheByGtfs.get(gtfs);
  if (!cache) {
    cache = new Map();
    lineCacheByGtfs.set(gtfs, cache);
  }
  let cached = cache.get(shapeId);
  if (cached) return cached;

  const shape = gtfs.shapes[shapeId];
  if (!shape || shape.coordinates.length < 2) return null;

  const line = lineString(shape.coordinates);
  const totalLength = turfLength(line);
  cached = { line, totalLength };
  cache.set(shapeId, cached);
  return cached;
}

/** Backfill routeId / directionId from static GTFS when the realtime feed
 *  doesn't supply them. The LIRR feed leaves trip.routeId empty in the
 *  protobuf even though the tripId matches a static trip — without this,
 *  every LIRR train would have routeId="" and fail shape lookup. Exported
 *  for unit tests. */
export function enrichWithStatic<T extends { tripId: string; routeId: string; directionId: number }>(
  entry: T,
  gtfs: StaticGtfsData,
): T {
  if (entry.routeId) return entry;
  const trip = gtfs.trips[entry.tripId];
  if (!trip) return entry;
  return { ...entry, routeId: trip.routeId, directionId: entry.directionId || trip.directionId };
}

export function interpolatePositions(
  vehicles: ParsedVehicle[],
  tripUpdates: ParsedTripUpdate[],
  gtfs: StaticGtfsData,
): TrainPosition[] {
  const now = Math.floor(Date.now() / 1000);
  getLookups(gtfs);

  vehicles = vehicles.map((v) => enrichWithStatic(v, gtfs));
  tripUpdates = tripUpdates.map((tu) => enrichWithStatic(tu, gtfs));

  // Index trip updates by tripId
  const tuByTrip = new Map<string, ParsedTripUpdate>();
  for (const tu of tripUpdates) {
    tuByTrip.set(tu.tripId, tu);
  }

  const results: TrainPosition[] = [];

  for (const vehicle of vehicles) {
    const pos = estimateVehicle(vehicle, tuByTrip.get(vehicle.tripId), gtfs, now);
    if (pos) results.push(pos);
  }

  // Also estimate from trip updates with no vehicle
  const vehicleTripIds = new Set(vehicles.map((v) => v.tripId));
  for (const tu of tripUpdates) {
    if (vehicleTripIds.has(tu.tripId)) continue;
    const pos = estimateFromTripUpdate(tu, gtfs, now);
    if (pos) results.push(pos);
  }

  return results;
}

function estimateVehicle(
  vehicle: ParsedVehicle,
  tripUpdate: ParsedTripUpdate | undefined,
  gtfs: StaticGtfsData,
  now: number,
): TrainPosition | null {
  const rs = findBestShape(vehicle.routeId, vehicle.directionId, vehicle.currentStopId, gtfs);
  if (!rs) return null;

  const lineData = getLine(rs.shapeId, gtfs);
  if (!lineData) return null;

  const distances = gtfs.stopDistances[rs.shapeId] ?? {};

  // Resolve the *effective* current leg. The vehicle's currentStopId is the
  // stop MTA last reported, but for sparse feeds (LIRR) that report is often
  // minutes stale. When we have a trip update, walk forward through its
  // stop_time_updates from the vehicle's reported stop to find the leg that
  // actually contains `now`. The vehicle's stop acts as a lower bound — we
  // never walk backwards. See ADR 002.
  let effectiveStopId = vehicle.currentStopId;
  let effectivePrevStopId: string | null = null;
  let effectiveStatus: ParsedVehicle["currentStatus"] = vehicle.currentStatus;
  let nextStopId: string | null = null;

  if (tripUpdate) {
    const startIdx = tripUpdate.stopTimeUpdates.findIndex(
      (stu) => stu.stopId === vehicle.currentStopId,
    );
    if (startIdx >= 0) {
      const leg = findCurrentLeg(tripUpdate, now, startIdx);
      effectiveStopId = tripUpdate.stopTimeUpdates[leg.nextIdx].stopId;
      effectivePrevStopId =
        leg.prevIdx !== leg.nextIdx ? tripUpdate.stopTimeUpdates[leg.prevIdx].stopId : null;
      effectiveStatus = leg.status;
      nextStopId =
        leg.nextIdx < tripUpdate.stopTimeUpdates.length - 1
          ? tripUpdate.stopTimeUpdates[leg.nextIdx + 1].stopId
          : null;
    } else {
      // vehicle.currentStopId isn't in this trip update's stop_time_updates
      // (rare — possibly stale vehicle entity, schedule reroute, or feed
      // mismatch). Keep the old fallback: derive prev from stopSequence.
      const adjacent = findAdjacentStops(vehicle, tripUpdate, rs, gtfs);
      effectivePrevStopId = adjacent.prevStopId;
      nextStopId = findNextStop(vehicle, rs, gtfs).nextStopId;
    }
  } else {
    // No trip update — no schedule data to walk against. Keep existing
    // midpoint behavior via findAdjacentStops + the 0.5-fraction fallback.
    const adjacent = findAdjacentStops(vehicle, undefined, rs, gtfs);
    effectivePrevStopId = adjacent.prevStopId;
    nextStopId = findNextStop(vehicle, rs, gtfs).nextStopId;
  }

  const stop = gtfs.stops[effectiveStopId];
  if (!stop) return null;
  const currentDist = distances[effectiveStopId];

  // Resolve delay from the *effective* current stop, not the vehicle's
  // claimed stop — when walking forward the relevant delay is for the
  // stop we're actually heading to.
  let delay: number | null = null;
  if (tripUpdate) {
    for (const stu of tripUpdate.stopTimeUpdates) {
      if (stu.stopId === effectiveStopId) {
        delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
        break;
      }
    }
  }

  let lat: number;
  let lon: number;
  let trainBearing: number | null = null;

  if (effectiveStatus === "STOPPED_AT") {
    lat = stop.lat;
    lon = stop.lon;
    if (currentDist !== undefined) {
      trainBearing = bearingAtDist(lineData, currentDist);
    }
  } else if (currentDist === undefined) {
    lat = stop.lat;
    lon = stop.lon;
  } else {
    const prevDist = effectivePrevStopId ? distances[effectivePrevStopId] : undefined;
    const nextDist = currentDist; // we're heading to effectiveStopId

    if (prevDist !== undefined && nextDist !== undefined && prevDist !== nextDist) {
      let fraction = 0.5;
      if (tripUpdate && effectivePrevStopId) {
        fraction = computeTimeFraction(tripUpdate, effectivePrevStopId, effectiveStopId, now);
      }

      const interpDist = prevDist + fraction * (nextDist - prevDist);
      const clamped = Math.max(0, Math.min(lineData.totalLength, interpDist));
      const pt = along(lineData.line, clamped);
      lon = pt.geometry.coordinates[0];
      lat = pt.geometry.coordinates[1];
      trainBearing = bearingAtDist(lineData, clamped);
    } else {
      lat = stop.lat;
      lon = stop.lon;
      trainBearing = bearingAtDist(lineData, currentDist);
    }
  }

  const nextStop = nextStopId ? gtfs.stops[nextStopId] : null;

  return {
    tripId: vehicle.tripId,
    routeId: vehicle.routeId,
    direction: (vehicle.directionId === 0 ? 0 : 1) as 0 | 1,
    latitude: lat,
    longitude: lon,
    bearing: trainBearing,
    status: effectiveStatus,
    currentStopId: effectiveStopId,
    currentStopName: stop.stopName,
    nextStopId,
    nextStopName: nextStop?.stopName ?? null,
    destination: rs.tripHeadsign,
    delay,
    updatedAt: vehicle.timestamp,
    lastObservedAt: vehicle.timestamp,
  };
}

function estimateFromTripUpdate(
  tu: ParsedTripUpdate,
  gtfs: StaticGtfsData,
  now: number,
): TrainPosition | null {
  if (tu.stopTimeUpdates.length === 0) return null;

  // Use the first stop in the update to find the right branch/shape
  const firstStopId = tu.stopTimeUpdates[0].stopId;
  const rs = findBestShape(tu.routeId, tu.directionId, firstStopId, gtfs);
  if (!rs) return null;

  const lineData = getLine(rs.shapeId, gtfs);
  if (!lineData) return null;

  const distances = gtfs.stopDistances[rs.shapeId] ?? {};

  const leg = findCurrentLeg(tu, now, 0);
  const prevStu = tu.stopTimeUpdates[leg.prevIdx];
  const nextStu = tu.stopTimeUpdates[leg.nextIdx];
  const afterNextStu =
    leg.nextIdx < tu.stopTimeUpdates.length - 1 ? tu.stopTimeUpdates[leg.nextIdx + 1] : null;

  const prevDist = distances[prevStu.stopId];
  const nextDist = distances[nextStu.stopId];
  const prevStop = gtfs.stops[prevStu.stopId];
  const nextStop = gtfs.stops[nextStu.stopId];

  if (prevDist === undefined || !prevStop) return null;

  let lat: number;
  let lon: number;
  let trainBearing: number | null = null;

  if (prevStu === nextStu || nextDist === undefined || prevDist === nextDist) {
    lat = prevStop.lat;
    lon = prevStop.lon;
  } else {
    const prevTime = prevStu.departure?.time ?? prevStu.arrival?.time ?? now;
    const nextTime = nextStu.arrival?.time ?? now;
    const fraction = nextTime > prevTime
      ? Math.max(0, Math.min(1, (now - prevTime) / (nextTime - prevTime)))
      : 0.5;

    const interpDist = prevDist + fraction * (nextDist - prevDist);
    const clamped = Math.max(0, Math.min(lineData.totalLength, interpDist));
    const pt = along(lineData.line, clamped);
    lon = pt.geometry.coordinates[0];
    lat = pt.geometry.coordinates[1];

    const behindDist = Math.max(0, clamped - 0.05);
    if (clamped - behindDist > 0.001) {
      const behindPt = along(lineData.line, behindDist);
      trainBearing = turfBearing(
        point(behindPt.geometry.coordinates),
        point(pt.geometry.coordinates),
      );
    }
  }

  const delay = nextStu.arrival?.delay ?? null;

  const afterNextStop = afterNextStu ? gtfs.stops[afterNextStu.stopId] ?? null : null;

  return {
    tripId: tu.tripId,
    routeId: tu.routeId,
    direction: (tu.directionId === 0 ? 0 : 1) as 0 | 1,
    latitude: lat,
    longitude: lon,
    bearing: trainBearing,
    status: prevStu === nextStu ? "STOPPED_AT" : "IN_TRANSIT_TO",
    // currentStop = the stop the train is at (STOPPED_AT) or heading to
    // (IN_TRANSIT_TO), matching GTFS-RT VehiclePosition semantics and
    // `estimateVehicle` above.
    currentStopId: nextStu.stopId,
    currentStopName: nextStop?.stopName ?? nextStu.stopId,
    // nextStop = the stop after currentStop in the trip sequence (or null
    // at end-of-trip). Used by the trip planner's "incoming train" check.
    nextStopId: afterNextStu?.stopId ?? null,
    nextStopName: afterNextStop?.stopName ?? null,
    destination: rs.tripHeadsign,
    delay,
    updatedAt: nextStu.arrival?.time ?? now,
    // No vehicle backed this position — pure schedule derivation.
    lastObservedAt: null,
  };
}

function findAdjacentStops(
  vehicle: ParsedVehicle,
  tripUpdate: ParsedTripUpdate | undefined,
  rs: RouteShape,
  gtfs: StaticGtfsData,
): { prevStopId: string | null } {
  // Try stop sequence pattern first
  const sequence = gtfs.stopSequences[rs.patternKey];
  if (sequence) {
    const idx = sequence.findIndex((s) => s.stopId === vehicle.currentStopId);
    if (idx > 0) {
      return { prevStopId: sequence[idx - 1].stopId };
    }
  }

  // Fall back to trip update
  if (tripUpdate) {
    const idx = tripUpdate.stopTimeUpdates.findIndex((s) => s.stopId === vehicle.currentStopId);
    if (idx > 0) {
      return { prevStopId: tripUpdate.stopTimeUpdates[idx - 1].stopId };
    }
  }

  return { prevStopId: null };
}

function findNextStop(
  vehicle: ParsedVehicle,
  rs: RouteShape,
  gtfs: StaticGtfsData,
): { nextStopId: string | null } {
  const sequence = gtfs.stopSequences[rs.patternKey];
  if (sequence) {
    const idx = sequence.findIndex((s) => s.stopId === vehicle.currentStopId);
    if (idx >= 0 && idx < sequence.length - 1) {
      return { nextStopId: sequence[idx + 1].stopId };
    }
  }
  return { nextStopId: null };
}

function computeTimeFraction(
  tripUpdate: ParsedTripUpdate,
  prevStopId: string,
  nextStopId: string,
  now: number,
): number {
  let departPrev: number | null = null;
  let arriveNext: number | null = null;

  for (const stu of tripUpdate.stopTimeUpdates) {
    if (stu.stopId === prevStopId) {
      departPrev = stu.departure?.time ?? stu.arrival?.time ?? null;
    }
    if (stu.stopId === nextStopId) {
      arriveNext = stu.arrival?.time ?? null;
    }
  }

  if (departPrev && arriveNext && arriveNext > departPrev) {
    return Math.max(0, Math.min(1, (now - departPrev) / (arriveNext - departPrev)));
  }

  return 0.5;
}

/**
 * Walk forward through a trip update's stop_time_updates to find the leg
 * that contains `now`. Returns indices into `tu.stopTimeUpdates`:
 *
 * - `prevIdx === nextIdx`: train is dwelling at that stop (status STOPPED_AT)
 * - `prevIdx + 1 === nextIdx`: train is on the leg between two stops (IN_TRANSIT_TO)
 * - past end of trip: both indices at the last stop, status STOPPED_AT
 *
 * `startFromIdx` lets callers skip past stops the train is already known to
 * be past — used by estimateVehicle to anchor at the vehicle's reported
 * currentStopId so we never walk backwards even if the schedule says we
 * should be behind it.
 *
 * Three states per stop, in order: not-yet-arrived → dwelling → departed.
 * Falling back arrival↔departure when one is missing handles origin stops
 * (departure-only) and terminal stops (arrival-only) without misclassifying
 * a dwelling train as in-transit to the following stop. See ADR 002.
 */
function findCurrentLeg(
  tu: ParsedTripUpdate,
  now: number,
  startFromIdx: number,
): { prevIdx: number; nextIdx: number; status: ParsedVehicle["currentStatus"] } {
  for (let i = startFromIdx; i < tu.stopTimeUpdates.length; i++) {
    const stu = tu.stopTimeUpdates[i];
    const arriveTime = stu.arrival?.time ?? stu.departure?.time ?? 0;
    const departTime = stu.departure?.time ?? stu.arrival?.time ?? 0;

    if (arriveTime > now) {
      const prev = i > 0 ? i - 1 : i;
      return { prevIdx: prev, nextIdx: i, status: "IN_TRANSIT_TO" };
    }
    if (departTime > now) {
      return { prevIdx: i, nextIdx: i, status: "STOPPED_AT" };
    }
  }
  const last = tu.stopTimeUpdates.length - 1;
  return { prevIdx: last, nextIdx: last, status: "STOPPED_AT" };
}
