import { Hono } from "hono";
import { loadStaticGtfs } from "../services/gtfs-loader.js";
import { ROUTE_INFO } from "@panoptrain/shared";
import type { Mode, RoutesGeoJSON, StopsGeoJSON, RouteFeature, StopFeature } from "@panoptrain/shared";

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

      // Group shapes by route — pick one representative shape per route+direction
      const seenRouteDir = new Set<string>();
      const features: RouteFeature[] = [];

      for (const trip of Object.values(gtfs.trips)) {
        const key = `${trip.routeId}-${trip.directionId}`;
        if (seenRouteDir.has(key)) continue;
        seenRouteDir.add(key);

        const shape = gtfs.shapes[trip.shapeId];
        if (!shape || shape.coordinates.length < 2) continue;

        const routeInfo = ROUTE_INFO[trip.routeId];
        features.push({
          type: "Feature",
          properties: {
            routeId: trip.routeId,
            color: routeInfo?.color ?? "#808183",
            name: routeInfo?.name ?? trip.routeId,
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

      const features: StopFeature[] = [];
      for (const stop of Object.values(gtfs.stops)) {
        if (stop.parentStation) continue;

        const routes = Array.from(routesByParent.get(stop.stopId) ?? []).sort();
        features.push({
          type: "Feature",
          properties: {
            stopId: stop.stopId,
            stopName: stop.stopName,
            routes,
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

// Subway router as the default export keeps the legacy /api routes working.
const subwayStatic = createStaticRouter("subway");
export default subwayStatic;
