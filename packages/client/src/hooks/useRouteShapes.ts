import { useState, useEffect } from "react";
import type { RoutesGeoJSON, StopsGeoJSON } from "@panoptrain/shared";
import { fetchRoutes, fetchStops } from "../lib/api.js";

interface UseRouteShapesResult {
  routeShapes: RoutesGeoJSON | null;
  stopsGeoJson: StopsGeoJSON | null;
  loading: boolean;
}

export function useRouteShapes(): UseRouteShapesResult {
  const [routeShapes, setRouteShapes] = useState<RoutesGeoJSON | null>(null);
  const [stopsGeoJson, setStopsGeoJson] = useState<StopsGeoJSON | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [routes, stops] = await Promise.all([fetchRoutes(), fetchStops()]);
        if (!cancelled) {
          setRouteShapes(routes);
          setStopsGeoJson(enrichStops(stops));
        }
      } catch (err) {
        console.error("Failed to load static data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { routeShapes, stopsGeoJson, loading };
}

const MAX_LABEL_ROUTES = 6;

/** Augment each stop feature with derived properties consumed by map layer
 *  expressions: numeric `routeCount` for hub sizing/filtering, and a
 *  preformatted `labelText` ("Times Sq-42 St · 1 2 3 N Q R W") for the
 *  detailed label layer. Doing this once at load avoids reasoning about
 *  array operations inside MapLibre expressions. */
function enrichStops(stops: StopsGeoJSON): StopsGeoJSON {
  return {
    ...stops,
    features: stops.features.map((f) => {
      const routes = f.properties.routes ?? [];
      const shown = routes.slice(0, MAX_LABEL_ROUTES).join(" ");
      const overflow = routes.length > MAX_LABEL_ROUTES ? ` +${routes.length - MAX_LABEL_ROUTES}` : "";
      const labelText = routes.length > 0
        ? `${f.properties.stopName} · ${shown}${overflow}`
        : f.properties.stopName;
      return {
        ...f,
        properties: {
          ...f.properties,
          routeCount: routes.length,
          labelText,
        },
      };
    }),
  };
}
