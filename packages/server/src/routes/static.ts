import { Hono } from "hono";
import { loadStaticGtfs } from "../services/gtfs-loader.js";
import { ROUTE_INFO } from "@panoptrain/shared";
import type { RoutesGeoJSON, StopsGeoJSON, RouteFeature, StopFeature } from "@panoptrain/shared";

const staticRoutes = new Hono();

// Cache the GeoJSON responses since static data doesn't change
let routesGeoJson: RoutesGeoJSON | null = null;
let stopsGeoJson: StopsGeoJSON | null = null;

staticRoutes.get("/routes", (c) => {
  if (!routesGeoJson) {
    const gtfs = loadStaticGtfs();

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
    const gtfs = loadStaticGtfs();

    // Build a map of parent station -> routes that serve it
    const routesByParent = new Map<string, Set<string>>();
    for (const [patternKey, sequence] of Object.entries(gtfs.stopSequences)) {
      const routeId = patternKey.split("-")[0];
      for (const { stopId } of sequence) {
        const platform = gtfs.stops[stopId];
        if (!platform?.parentStation) continue;
        if (!routesByParent.has(platform.parentStation)) {
          routesByParent.set(platform.parentStation, new Set());
        }
        routesByParent.get(platform.parentStation)!.add(routeId);
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

export default staticRoutes;
