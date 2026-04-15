import along from "@turf/along";
import turfLength from "@turf/length";
import turfBearing from "@turf/bearing";
import { lineString, point } from "@turf/helpers";
import type { TrainPosition, ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";
import type { StaticGtfsData } from "./gtfs-loader.js";

/**
 * Pre-computed lookups, built once:
 * 1. route+direction -> ALL shapes (for branching routes like A/E)
 * 2. stopId -> which shapes contain it (for matching trains to correct branch)
 */
interface RouteShape {
  shapeId: string;
  tripHeadsign: string;
  patternKey: string; // "routeId-directionId-shapeId"
}

let allRouteShapes: Map<string, RouteShape[]> | null = null;
let stopToShapes: Map<string, RouteShape[]> | null = null;
let crossRouteStopToShapes: Map<string, RouteShape[]> | null = null;

function buildLookups(gtfs: StaticGtfsData): void {
  if (allRouteShapes) return;

  allRouteShapes = new Map();
  stopToShapes = new Map();
  crossRouteStopToShapes = new Map();
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

    if (!allRouteShapes.has(routeKey)) allRouteShapes.set(routeKey, []);
    allRouteShapes.get(routeKey)!.push(rs);

    // Index every stop on this shape
    const dists = gtfs.stopDistances[trip.shapeId];
    if (dists) {
      for (const stopId of Object.keys(dists)) {
        const stopKey = `${trip.routeId}-${trip.directionId}-${stopId}`;
        if (!stopToShapes.has(stopKey)) stopToShapes.set(stopKey, []);
        stopToShapes.get(stopKey)!.push(rs);

        // Cross-route index: any shape containing this stop, regardless of route
        const crossKey = `${trip.directionId}-${stopId}`;
        if (!crossRouteStopToShapes.has(crossKey)) crossRouteStopToShapes.set(crossKey, []);
        crossRouteStopToShapes.get(crossKey)!.push(rs);
      }
    }
  }

  let totalShapes = 0;
  for (const shapes of allRouteShapes.values()) totalShapes += shapes.length;
  console.log(`  Built route->shape lookup: ${allRouteShapes.size} route+direction combos, ${totalShapes} total shapes`);
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
  buildLookups(gtfs);

  // Pass 1: Exact route+stop match — handles normal operation and branching routes
  const stopKey = `${routeId}-${directionId}-${stopId}`;
  const byStop = stopToShapes!.get(stopKey);
  if (byStop && byStop.length > 0) return byStop[0];

  // Pass 2: Cross-route stop match — handles rerouted trains (e.g., 1 on A/C/E tracks)
  const crossKey = `${directionId}-${stopId}`;
  const byCrossStop = crossRouteStopToShapes!.get(crossKey);
  if (byCrossStop && byCrossStop.length > 0) return byCrossStop[0];

  // Pass 3: Any shape for this route+direction (last resort)
  const routeKey = `${routeId}-${directionId}`;
  const all = allRouteShapes!.get(routeKey);
  if (all && all.length > 0) return all[0];

  return null;
}

// Cache lineString + length computations per shape
interface LineData { line: ReturnType<typeof lineString>; totalLength: number }
const lineCache = new Map<string, LineData>();

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
  let cached = lineCache.get(shapeId);
  if (cached) return cached;

  const shape = gtfs.shapes[shapeId];
  if (!shape || shape.coordinates.length < 2) return null;

  const line = lineString(shape.coordinates);
  const totalLength = turfLength(line);
  cached = { line, totalLength };
  lineCache.set(shapeId, cached);
  return cached;
}

export function interpolatePositions(
  vehicles: ParsedVehicle[],
  tripUpdates: ParsedTripUpdate[],
  gtfs: StaticGtfsData,
): TrainPosition[] {
  const now = Math.floor(Date.now() / 1000);
  buildLookups(gtfs);

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

  const stop = gtfs.stops[vehicle.currentStopId];
  if (!stop) return null;

  const distances = gtfs.stopDistances[rs.shapeId] ?? {};
  const currentDist = distances[vehicle.currentStopId];

  // Resolve delay from trip update
  let delay: number | null = null;
  if (tripUpdate) {
    for (const stu of tripUpdate.stopTimeUpdates) {
      if (stu.stopId === vehicle.currentStopId) {
        delay = stu.arrival?.delay ?? stu.departure?.delay ?? null;
        break;
      }
    }
  }

  let lat: number;
  let lon: number;
  let trainBearing: number | null = null;

  if (vehicle.currentStatus === "STOPPED_AT") {
    lat = stop.lat;
    lon = stop.lon;
    // Even for stopped trains, compute bearing from the shape direction at this stop
    if (currentDist !== undefined) {
      trainBearing = bearingAtDist(lineData, currentDist);
    }
  } else if (currentDist === undefined) {
    lat = stop.lat;
    lon = stop.lon;
  } else {
    // Moving — find adjacent stops and interpolate
    const adjacent = findAdjacentStops(vehicle, tripUpdate, rs, gtfs);

    const prevDist = adjacent.prevStopId ? distances[adjacent.prevStopId] : undefined;
    const nextDist = distances[vehicle.currentStopId]; // currentStopId is the one we're heading to

    if (prevDist !== undefined && nextDist !== undefined && prevDist !== nextDist) {
      let fraction = 0.5;
      if (tripUpdate) {
        fraction = computeTimeFraction(tripUpdate, adjacent.prevStopId!, vehicle.currentStopId, now);
      }

      const interpDist = prevDist + fraction * (nextDist - prevDist);
      const clamped = Math.max(0, Math.min(lineData.totalLength, interpDist));
      const pt = along(lineData.line, clamped);
      lon = pt.geometry.coordinates[0];
      lat = pt.geometry.coordinates[1];
      trainBearing = bearingAtDist(lineData, clamped);
    } else {
      // First stop on route or can't find prev — place at the stop but with shape bearing
      lat = stop.lat;
      lon = stop.lon;
      trainBearing = bearingAtDist(lineData, currentDist);
    }
  }

  // Find next stop name
  const { nextStopId } = findNextStop(vehicle, rs, gtfs);
  const nextStop = nextStopId ? gtfs.stops[nextStopId] : null;

  return {
    tripId: vehicle.tripId,
    routeId: vehicle.routeId,
    direction: (vehicle.directionId === 0 ? 0 : 1) as 0 | 1,
    latitude: lat,
    longitude: lon,
    bearing: trainBearing,
    status: vehicle.currentStatus,
    currentStopId: vehicle.currentStopId,
    currentStopName: stop.stopName,
    nextStopId: nextStopId,
    nextStopName: nextStop?.stopName ?? null,
    destination: rs.tripHeadsign,
    delay,
    updatedAt: vehicle.timestamp,
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

  // Find which two stops the train is between based on time
  let prevStu = tu.stopTimeUpdates[0];
  let nextStu = tu.stopTimeUpdates[0];

  for (let i = 0; i < tu.stopTimeUpdates.length; i++) {
    const stu = tu.stopTimeUpdates[i];
    const arrTime = stu.arrival?.time ?? 0;
    if (arrTime > now) {
      nextStu = stu;
      prevStu = i > 0 ? tu.stopTimeUpdates[i - 1] : stu;
      break;
    }
    prevStu = stu;
    nextStu = stu;
  }

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

  return {
    tripId: tu.tripId,
    routeId: tu.routeId,
    direction: (tu.directionId === 0 ? 0 : 1) as 0 | 1,
    latitude: lat,
    longitude: lon,
    bearing: trainBearing,
    status: prevStu === nextStu ? "STOPPED_AT" : "IN_TRANSIT_TO",
    currentStopId: nextStu.stopId,
    currentStopName: nextStop?.stopName ?? nextStu.stopId,
    nextStopId: nextStu.stopId,
    nextStopName: nextStop?.stopName ?? null,
    destination: rs.tripHeadsign,
    delay,
    updatedAt: nextStu.arrival?.time ?? now,
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
