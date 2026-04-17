import type { TripPlan, RideSegment, TransferSegment, TrainPosition } from "@panoptrain/shared";
import type { StaticGtfsData } from "./gtfs-loader.js";
import { getCurrentSnapshot } from "./cache.js";

const AVG_SPEED_KMH = 30;
const DWELL_MIN_PER_STOP = 0.5;
const TRANSFER_MIN = 1;
const TRANSFER_PENALTY = 5;

interface RideEdge {
  type: "ride";
  to: string;
  routeId: string;
  distanceKm: number;
}

interface TransferEdge {
  type: "transfer";
  to: string;
}

type Edge = RideEdge | TransferEdge;

export interface StationGraph {
  adjacency: Map<string, Edge[]>;
  /** Maps parent station ID to its child platform stop IDs */
  childrenByParent: Map<string, string[]>;
}

/**
 * Build a station adjacency graph from static GTFS data. Runs once at startup.
 *
 * - Ride edges: between consecutive stops on each route+direction+shape pattern
 * - Transfer edges: between sibling platforms sharing the same parent station
 */
export function buildStationGraph(gtfs: StaticGtfsData): StationGraph {
  const adjacency = new Map<string, Edge[]>();
  const addEdge = (from: string, edge: Edge): void => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(edge);
  };

  // Ride edges from stop sequences
  for (const [patternKey, sequence] of Object.entries(gtfs.stopSequences)) {
    const [routeId, , shapeId] = patternKey.split("-");
    if (!routeId || !shapeId) continue;
    const distances = gtfs.stopDistances[shapeId] ?? {};
    for (let i = 0; i < sequence.length - 1; i++) {
      const from = sequence[i].stopId;
      const to = sequence[i + 1].stopId;
      const dFrom = distances[from] ?? 0;
      const dTo = distances[to] ?? 0;
      const distanceKm = Math.max(0, dTo - dFrom);
      addEdge(from, { type: "ride", to, routeId, distanceKm });
    }
  }

  // Group platform stops by parent station
  const childrenByParent = new Map<string, string[]>();
  for (const stop of Object.values(gtfs.stops)) {
    if (!stop.parentStation) continue;
    if (!childrenByParent.has(stop.parentStation)) {
      childrenByParent.set(stop.parentStation, []);
    }
    childrenByParent.get(stop.parentStation)!.push(stop.stopId);
  }

  // Also group all platforms by parent station NAME — NYC complex stations
  // (e.g., Union Sq, Times Sq, Atlantic-Barclays) have separate parent stations
  // per line group that share the same stopName.
  const platformsByName = new Map<string, string[]>();
  for (const stop of Object.values(gtfs.stops)) {
    if (stop.parentStation) continue; // only parents
    const platforms = childrenByParent.get(stop.stopId) ?? [];
    if (platforms.length === 0) continue;
    if (!platformsByName.has(stop.stopName)) {
      platformsByName.set(stop.stopName, []);
    }
    platformsByName.get(stop.stopName)!.push(...platforms);
  }

  // Add bidirectional transfer edges between all platforms sharing a station name
  for (const platforms of platformsByName.values()) {
    if (platforms.length < 2) continue;
    for (const a of platforms) {
      for (const b of platforms) {
        if (a !== b) addEdge(a, { type: "transfer", to: b });
      }
    }
  }

  return { adjacency, childrenByParent };
}

/** Resolve a stop ID (parent or platform) to its platform stop IDs. */
function resolvePlatforms(graph: StationGraph, stopId: string, gtfs: StaticGtfsData): string[] {
  const stop = gtfs.stops[stopId];
  if (!stop) return [];
  if (stop.parentStation) {
    // It's already a platform — return just it
    return [stopId];
  }
  // It's a parent — return its children
  return graph.childrenByParent.get(stopId) ?? [stopId];
}

interface PathStep {
  stopId: string;
  edge: Edge | null; // null for sources
  prevState: string | null;
}

/** Compose state key as "stopId|routeIdOrEmpty" — tracks current train so we
 *  prefer staying on the same route over switching at shared stops. */
function stateKey(stopId: string, routeId: string | null): string {
  return `${stopId}|${routeId ?? ""}`;
}

/**
 * Plan a trip from one parent station to another.
 * Dijkstra over (stopId, currentRouteId) states. Switching trains at the same
 * stop counts as an implicit transfer to discourage spurious route changes.
 */
export function planTrip(
  graph: StationGraph,
  gtfs: StaticGtfsData,
  fromId: string,
  toId: string,
): TripPlan | null {
  const fromStop = gtfs.stops[fromId];
  const toStop = gtfs.stops[toId];
  if (!fromStop || !toStop) return null;
  if (fromId === toId) return null;

  const sources = resolvePlatforms(graph, fromId, gtfs);
  const targetSet = new Set(resolvePlatforms(graph, toId, gtfs));
  if (sources.length === 0 || targetSet.size === 0) return null;

  // Dijkstra over states: stateKey → cost; steps map for reconstruction
  const dist = new Map<string, number>();
  const steps = new Map<string, PathStep>();
  const queue: { stopId: string; route: string | null; cost: number }[] = [];

  for (const s of sources) {
    const k = stateKey(s, null);
    dist.set(k, 0);
    steps.set(k, { stopId: s, edge: null, prevState: null });
    queue.push({ stopId: s, route: null, cost: 0 });
  }

  let foundState: string | null = null;

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { stopId, route, cost } = queue.shift()!;
    const key = stateKey(stopId, route);
    if (cost > (dist.get(key) ?? Infinity)) continue;

    if (targetSet.has(stopId)) {
      foundState = key;
      break;
    }

    const edges = graph.adjacency.get(stopId) ?? [];
    for (const edge of edges) {
      let weight: number;
      let nextRoute: string | null;
      if (edge.type === "ride") {
        // Same route = cheap continuation; different route = implicit transfer
        weight = route === edge.routeId ? 1 : 1 + TRANSFER_PENALTY;
        nextRoute = edge.routeId;
      } else {
        weight = TRANSFER_PENALTY;
        nextRoute = null;
      }
      const nextCost = cost + weight;
      const nextKey = stateKey(edge.to, nextRoute);
      if (nextCost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nextCost);
        steps.set(nextKey, { stopId: edge.to, edge, prevState: key });
        queue.push({ stopId: edge.to, route: nextRoute, cost: nextCost });
      }
    }
  }

  if (!foundState) return null;

  // Reconstruct path
  const path: PathStep[] = [];
  let current: string | null = foundState;
  while (current) {
    const step = steps.get(current);
    if (!step) break;
    path.unshift(step);
    current = step.prevState;
  }

  // Group consecutive ride edges by routeId; transfers become their own segments
  const segments: Array<RideSegment | TransferSegment> = [];
  let i = 1; // path[0] is source, no edge
  while (i < path.length) {
    const step = path[i];
    const edge = step.edge!;
    if (edge.type === "transfer") {
      segments.push({
        type: "transfer",
        atStopName: gtfs.stops[step.stopId]?.stopName ?? step.stopId,
        minutes: TRANSFER_MIN,
      });
      i++;
      continue;
    }
    // Collect consecutive ride edges with the same routeId
    const routeId = edge.routeId;
    const boardStopId = path[i - 1].stopId;
    const stopIds: string[] = [boardStopId];
    let totalDistKm = 0;
    let intermediateStops = -1;
    let lastStopId = boardStopId;
    while (i < path.length) {
      const e = path[i].edge;
      if (!e || e.type !== "ride" || e.routeId !== routeId) break;
      totalDistKm += e.distanceKm;
      intermediateStops++;
      lastStopId = path[i].stopId;
      stopIds.push(lastStopId);
      i++;
    }
    const rideMin = (totalDistKm / AVG_SPEED_KMH) * 60 + Math.max(0, intermediateStops) * DWELL_MIN_PER_STOP;
    segments.push({
      type: "ride",
      routeId,
      boardAt: { stopId: boardStopId, stopName: gtfs.stops[boardStopId]?.stopName ?? boardStopId },
      alightAt: { stopId: lastStopId, stopName: gtfs.stops[lastStopId]?.stopName ?? lastStopId },
      stops: stopIds.map((id) => ({ stopId: id, stopName: gtfs.stops[id]?.stopName ?? id })),
      path: extractShapePath(gtfs, routeId, stopIds),
      intermediateStops: Math.max(0, intermediateStops),
      minutes: Math.round(rideMin * 10) / 10,
      delaySeconds: null, // filled in below
    });
  }

  // Overlay real-time delays from current train snapshot
  enrichWithDelays(segments);

  const totalMinutes = Math.round(segments.reduce((sum, s) => sum + s.minutes, 0));
  const totalStops = segments.reduce((sum, s) => (s.type === "ride" ? sum + s.intermediateStops + 1 : sum), 0);
  const transferCount = segments.filter((s) => s.type === "transfer").length;

  return {
    from: { stopId: fromId, stopName: fromStop.stopName },
    to: { stopId: toId, stopName: toStop.stopName },
    totalMinutes,
    totalStops,
    transferCount,
    segments,
  };
}

/** Extract shape coordinates between the first and last stops of a ride segment. */
function extractShapePath(
  gtfs: StaticGtfsData,
  routeId: string,
  stopIds: string[],
): [number, number][] {
  if (stopIds.length < 2) return [];

  // Find a shape that contains these stops
  for (const trip of Object.values(gtfs.trips)) {
    if (trip.routeId !== routeId) continue;
    const dists = gtfs.stopDistances[trip.shapeId];
    if (!dists) continue;

    const firstDist = dists[stopIds[0]];
    const lastDist = dists[stopIds[stopIds.length - 1]];
    if (firstDist === undefined || lastDist === undefined) continue;

    const shape = gtfs.shapes[trip.shapeId];
    if (!shape) continue;

    // Walk shape coordinates and extract those between firstDist and lastDist
    const minDist = Math.min(firstDist, lastDist);
    const maxDist = Math.max(firstDist, lastDist);
    const coords: [number, number][] = [];
    let cumDist = 0;

    for (let j = 0; j < shape.coordinates.length; j++) {
      if (j > 0) {
        const [lon1, lat1] = shape.coordinates[j - 1];
        const [lon2, lat2] = shape.coordinates[j];
        const segLen = Math.sqrt((lon2 - lon1) ** 2 + (lat2 - lat1) ** 2) * 111.32; // rough km
        cumDist += segLen;
      }
      if (cumDist >= minDist && cumDist <= maxDist + 0.01) {
        coords.push(shape.coordinates[j]);
      }
      if (cumDist > maxDist + 0.5) break;
    }

    if (coords.length >= 2) return coords;
  }

  // Fallback: just use stop coordinates
  return stopIds
    .map((id) => gtfs.stops[id])
    .filter(Boolean)
    .map((s) => [s!.lon, s!.lat] as [number, number]);
}

/** Cross-reference ride segments with live train delays. */
function enrichWithDelays(segments: Array<RideSegment | TransferSegment>): void {
  const snapshot = getCurrentSnapshot();
  if (!snapshot) return;

  // Index trains by routeId for quick lookup
  const trainsByRoute = new Map<string, TrainPosition[]>();
  for (const t of snapshot.trains) {
    if (t.delay === null || t.delay === 0) continue;
    if (!trainsByRoute.has(t.routeId)) trainsByRoute.set(t.routeId, []);
    trainsByRoute.get(t.routeId)!.push(t);
  }

  for (const seg of segments) {
    if (seg.type !== "ride") continue;
    const trains = trainsByRoute.get(seg.routeId);
    if (!trains || trains.length === 0) continue;

    // Find trains at/near stops in this segment
    const segStopIds = new Set(seg.stops.map((s) => s.stopId));
    const matchingDelays = trains
      .filter((t) => segStopIds.has(t.currentStopId))
      .map((t) => t.delay!);

    if (matchingDelays.length > 0) {
      seg.delaySeconds = Math.round(
        matchingDelays.reduce((a, b) => a + b, 0) / matchingDelays.length,
      );
    }
  }
}
