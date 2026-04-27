import { Hono } from "hono";
import { loadStaticGtfs } from "../services/gtfs-loader.js";
import { ROUTE_INFO } from "@panoptrain/shared";
import type { Mode, RoutesGeoJSON, StopsGeoJSON, RouteFeature, StopFeature } from "@panoptrain/shared";

/** Stations the LIRR explicitly elevates to "major hub" prominence on the
 *  map. routeCount alone isn't a good proxy on LIRR because Jamaica is the
 *  only station that touches every branch — Penn / Atlantic / Grand Central
 *  serve fewer routes by count but are the western terminals everyone knows.
 *  Curating by name keeps the rendering decoupled from MTA's evolving
 *  GTFS route_id assignments. */
const LIRR_MAJOR_HUBS = new Set([
  "Penn Station",
  "Jamaica",
  "Atlantic Terminal",
  "Grand Central",
  "Long Island City",
]);

/** Map a stop to a 0/1/2 importance bucket. Subway uses the existing
 *  routeCount thresholds (8+ = hub, 4+ = mid). LIRR uses a curated hub list
 *  and treats every other stop as importance 1, since the network is
 *  geographically sparse and riders need labels at wider zooms than subway.
 *  Exported for unit tests. */
export function stationImportance(mode: Mode, stopName: string, routeCount: number): 0 | 1 | 2 {
  if (mode === "lirr") {
    if (LIRR_MAJOR_HUBS.has(stopName)) return 2;
    return 1;
  }
  if (routeCount >= 8) return 2;
  if (routeCount >= 4) return 1;
  return 0;
}

export interface ShapeCandidate {
  shapeId: string;
  routeId: string;
  directionId: number;
  coordCount: number;
  /** Ordered stop_ids the trip visits along this shape. */
  stopSequence: string[];
}

/** Pick which shapes to emit on `/routes`. For each (route, direction):
 *  always keep the longest shape, then add extras only when an endpoint
 *  reaches a terminal stop the main shape doesn't touch.
 *
 *  Why: "longest per route+direction" alone silently dropped track for LIRR
 *  branches with multiple western terminals (e.g. Babylon trips end at Penn,
 *  Atlantic Terminal, AND Grand Central — only Penn won by length, leaving
 *  Atlantic / GCT lines grey). Including every distinct (origin, terminus)
 *  pair instead would balloon subway 2.5x with short-turn variants whose
 *  endpoints are mid-line on the main shape — visually invisible overlays
 *  that just bloat the /routes payload.
 *
 *  Exported for unit tests so we can pin both the LIRR multi-terminal case
 *  and the subway short-turn-suppression case without spinning up Hono. */
export function pickShapes(candidates: ShapeCandidate[]): ShapeCandidate[] {
  const grouped = new Map<string, ShapeCandidate[]>();
  for (const c of candidates) {
    if (c.coordCount < 2 || c.stopSequence.length < 2) continue;
    const key = `${c.routeId}-${c.directionId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(c);
  }

  const selected: ShapeCandidate[] = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => b.coordCount - a.coordCount);
    const main = group[0];
    selected.push(main);
    const mainStops = new Set(main.stopSequence);
    const extraCovered = new Set<string>();
    for (let i = 1; i < group.length; i++) {
      const c = group[i];
      const firstStop = c.stopSequence[0];
      const lastStop = c.stopSequence[c.stopSequence.length - 1];
      const firstNew = !mainStops.has(firstStop);
      const lastNew = !mainStops.has(lastStop);
      if (!firstNew && !lastNew) continue;
      const newTerminal = firstNew ? firstStop : lastStop;
      if (extraCovered.has(newTerminal)) continue;
      extraCovered.add(newTerminal);
      selected.push(c);
    }
  }
  return selected;
}

/** Build a `/api/<mode>` router with /routes and /stops endpoints. The
 *  GeoJSON caches are scoped per mode so subway and LIRR don't trample each
 *  other's data. */
export function createStaticRouter(mode: Mode): Hono {
  const staticRoutes = new Hono();

  let routesGeoJson: RoutesGeoJSON | null = null;
  let stopsGeoJson: StopsGeoJSON | null = null;

  staticRoutes.get("/routes", (c) => {
    if (!routesGeoJson) {
      const gtfs = loadStaticGtfs(mode);

      // Build candidate list: one entry per unique (route, direction, shape)
      // pattern, with its stop sequence pulled from the pre-built map.
      const candidates: ShapeCandidate[] = [];
      const seenShapes = new Set<string>();
      for (const trip of Object.values(gtfs.trips)) {
        const shapeKey = `${trip.routeId}-${trip.directionId}-${trip.shapeId}`;
        if (seenShapes.has(shapeKey)) continue;
        seenShapes.add(shapeKey);
        const shape = gtfs.shapes[trip.shapeId];
        if (!shape) continue;
        const sequence = gtfs.stopSequences[shapeKey];
        if (!sequence) continue;
        candidates.push({
          shapeId: trip.shapeId,
          routeId: trip.routeId,
          directionId: trip.directionId,
          coordCount: shape.coordinates.length,
          stopSequence: sequence.map((s) => s.stopId),
        });
      }

      const features: RouteFeature[] = [];
      for (const c of pickShapes(candidates)) {
        const shape = gtfs.shapes[c.shapeId]!;
        // Prefer the per-mode static GTFS data (correct colors for both subway
        // and LIRR). Fall back to ROUTE_INFO for any subway lines whose GTFS
        // route_color is missing. Falling back to ROUTE_INFO without checking
        // mode would hijack LIRR route IDs (e.g. LIRR "1" Babylon green
        // collides with subway "1" red).
        const gtfsRoute = gtfs.routes[c.routeId];
        const subwayInfo = mode === "subway" ? ROUTE_INFO[c.routeId] : undefined;
        features.push({
          type: "Feature",
          properties: {
            routeId: c.routeId,
            color: gtfsRoute?.color ?? subwayInfo?.color ?? "#808183",
            name: gtfsRoute?.longName ?? subwayInfo?.name ?? c.routeId,
          },
          geometry: {
            type: "LineString",
            coordinates: shape.coordinates,
          },
        });
      }

      routesGeoJson = { type: "FeatureCollection", features };
    }

    c.header("Cache-Control", "public, max-age=86400");
    return c.json(routesGeoJson);
  });

  staticRoutes.get("/stops", (c) => {
    if (!stopsGeoJson) {
      const gtfs = loadStaticGtfs(mode);

      // Build a map of station -> routes that serve it. Subway stops have a
      // parent_station (the abstract complex); LIRR stops are flat with no
      // parent. Treat the stop itself as its own parent when none is set so
      // both modes populate correctly.
      const routesByParent = new Map<string, Set<string>>();
      for (const [patternKey, sequence] of Object.entries(gtfs.stopSequences)) {
        const routeId = patternKey.split("-")[0];
        for (const { stopId } of sequence) {
          const platform = gtfs.stops[stopId];
          if (!platform) continue;
          const parentId = platform.parentStation ?? platform.stopId;
          if (!routesByParent.has(parentId)) {
            routesByParent.set(parentId, new Set());
          }
          routesByParent.get(parentId)!.add(routeId);
        }
      }

      // Set of stops that ARE child platforms of an existing parent stop —
      // these we skip because the parent represents the station. A child
      // stop with a *missing* parent reference (malformed GTFS) is treated
      // as top-level rather than silently dropped from the map (intent:
      // emit one feature per top-level station).
      const allStopIds = new Set(Object.keys(gtfs.stops));

      const features: StopFeature[] = [];
      for (const stop of Object.values(gtfs.stops)) {
        if (stop.parentStation && allStopIds.has(stop.parentStation)) continue;

        const routes = Array.from(routesByParent.get(stop.stopId) ?? []).sort();
        features.push({
          type: "Feature",
          properties: {
            stopId: stop.stopId,
            stopName: stop.stopName,
            routes,
            importance: stationImportance(mode, stop.stopName, routes.length),
          },
          geometry: {
            type: "Point",
            coordinates: [stop.lon, stop.lat],
          },
        });
      }

      stopsGeoJson = { type: "FeatureCollection", features };
    }

    c.header("Cache-Control", "public, max-age=86400");
    return c.json(stopsGeoJson);
  });

  return staticRoutes;
}
