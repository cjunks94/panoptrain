import { useState, useEffect } from "react";
import type { Mode, RoutesGeoJSON, StopsGeoJSON } from "@panoptrain/shared";
import { fetchRoutes, fetchStops } from "../lib/api.js";

interface UseRouteShapesResult {
  routeShapes: RoutesGeoJSON | null;
  stopsGeoJson: StopsGeoJSON | null;
  loading: boolean;
}

export function useRouteShapes(mode: Mode): UseRouteShapesResult {
  const [routeShapes, setRouteShapes] = useState<RoutesGeoJSON | null>(null);
  const [stopsGeoJson, setStopsGeoJson] = useState<StopsGeoJSON | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Reset state on mode flip so we don't show subway shapes briefly while
    // LIRR data is still loading.
    setRouteShapes(null);
    setStopsGeoJson(null);

    // Fetch stops and routes independently so each renders as soon as it's
    // ready (PT-104). The routes GeoJSON is multi-MB; previously Promise.all
    // held back the smaller stops payload until both resolved. With them
    // decoupled, station dots/labels appear well before the route lines.
    fetchStops(mode)
      .then((stops) => { if (!cancelled) setStopsGeoJson(enrichStops(stops)); })
      .catch((err) => console.error("Failed to load stops:", err));

    fetchRoutes(mode)
      .then((routes) => { if (!cancelled) setRouteShapes(routes); })
      .catch((err) => console.error("Failed to load routes:", err));

    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Derive `loading` from state so it accurately reflects "any payload still
  // pending". With the parallel-fetch pattern a single useState flag would
  // either lie (flips early when one fetch finishes) or hang forever (waits
  // only for one). Consumers can also gate on the individual values directly.
  const loading = routeShapes === null || stopsGeoJson === null;
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
