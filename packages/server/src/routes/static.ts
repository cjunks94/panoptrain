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

      // For each route+direction, pick the LONGEST shape (most coordinates)
      // as the representative. The naive "first trip wins" approach silently
      // drops track when a route has multiple service patterns sharing a
      // common segment — e.g. LIRR Port Jefferson Branch has 23 shape
      // variants; the most-frequent is Penn→Huntington (electric service)
      // while a smaller fraction of trips extend Huntington→Port Jefferson
      // (diesel). Picking by max coordinates gives full geographic extent
      // because longer service patterns are supersets of shorter ones.
      const longestPerRouteDir = new Map<string, { trip: typeof gtfs.trips[string]; coordCount: number }>();
      for (const trip of Object.values(gtfs.trips)) {
        const shape = gtfs.shapes[trip.shapeId];
        if (!shape || shape.coordinates.length < 2) continue;
        const key = `${trip.routeId}-${trip.directionId}`;
        const current = longestPerRouteDir.get(key);
        if (!current || shape.coordinates.length > current.coordCount) {
          longestPerRouteDir.set(key, { trip, coordCount: shape.coordinates.length });
        }
      }

      const features: RouteFeature[] = [];
      for (const { trip } of longestPerRouteDir.values()) {
        const shape = gtfs.shapes[trip.shapeId]!;

        // Prefer the per-mode static GTFS data (correct colors for both subway
        // and LIRR). Fall back to ROUTE_INFO for any subway lines whose GTFS
        // route_color is missing. Falling back to ROUTE_INFO without checking
        // mode would hijack LIRR route IDs (e.g. LIRR "1" Babylon green
        // collides with subway "1" red).
        const gtfsRoute = gtfs.routes[trip.routeId];
        const subwayInfo = mode === "subway" ? ROUTE_INFO[trip.routeId] : undefined;
        features.push({
          type: "Feature",
          properties: {
            routeId: trip.routeId,
            color: gtfsRoute?.color ?? subwayInfo?.color ?? "#808183",
            name: gtfsRoute?.longName ?? subwayInfo?.name ?? trip.routeId,
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
