import { useState, useEffect, useCallback } from "react";
import type { Mode, RoutesGeoJSON, StopsGeoJSON } from "@panoptrain/shared";
import { fetchRoutes, fetchStops } from "../lib/api.js";
import {
  getRoutes as getCachedRoutes,
  setRoutes as setCachedRoutes,
  getStops as getCachedStops,
  setStops as setCachedStops,
} from "../lib/modeCache.js";

interface UseRouteShapesResult {
  routeShapes: RoutesGeoJSON | null;
  stopsGeoJson: StopsGeoJSON | null;
  loading: boolean;
  /** Non-null when the last load attempt failed. Consumers can surface this
   *  instead of spinning forever. */
  error: Error | null;
  /** Re-runs the fetch for the current mode. Stable identity. */
  retry: () => void;
}

export function useRouteShapes(mode: Mode | null): UseRouteShapesResult {
  const [routeShapes, setRouteShapes] = useState<RoutesGeoJSON | null>(null);
  const [stopsGeoJson, setStopsGeoJson] = useState<StopsGeoJSON | null>(null);
  // A failed load previously left `loading` true forever, because it derives
  // from "either payload is still null" and nothing ever retried or surfaced
  // the failure. The map pulsed "Loading subway routes..." for the rest of the
  // session and trains fell back to linear interpolation (#133).
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Real cancellation, not just ignoring the result (#133). These payloads
    // are multi-MB, so toggling Subway<->LIRR a few times on mobile
    // previously left several downloads and JSON parses running concurrently.
    const controller = new AbortController();

    if (mode === null) {
      // Airspace view — clear transit shapes (no place for them here).
      setRouteShapes(null);
      setStopsGeoJson(null);
      return;
    }

    // Cache hit replaces the prior mode's payload synchronously, so there's
    // no need to flash null first. On miss, set null then fetch — preserves
    // the original "don't show subway shapes briefly while LIRR loads"
    // guarantee. Stops and routes resolve independently (PT-104).
    const cachedRoutes = getCachedRoutes(mode);
    setRouteShapes(cachedRoutes ?? null);

    const cachedStops = getCachedStops(mode);
    setStopsGeoJson(cachedStops ? enrichStops(cachedStops) : null);

    if (!cachedStops) {
      fetchStops(mode, controller.signal)
        .then((stops) => {
          if (cancelled) return;
          setCachedStops(mode, stops);
          setStopsGeoJson(enrichStops(stops));
          setError(null);
        })
        .catch((err) => {
          if (cancelled || controller.signal.aborted) return;
          console.error("Failed to load stops:", err);
          setError(err instanceof Error ? err : new Error(String(err)));
        });
    }

    if (!cachedRoutes) {
      fetchRoutes(mode, controller.signal)
        .then((routes) => {
          if (cancelled) return;
          setCachedRoutes(mode, routes);
          setRouteShapes(routes);
          setError(null);
        })
        .catch((err) => {
          if (cancelled || controller.signal.aborted) return;
          console.error("Failed to load routes:", err);
          setError(err instanceof Error ? err : new Error(String(err)));
        });
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, attempt]);

  // Derive `loading` from state so it accurately reflects "any payload still
  // pending". With the parallel-fetch pattern a single useState flag would
  // either lie (flips early when one fetch finishes) or hang forever (waits
  // only for one). Consumers can also gate on the individual values directly.
  // On airspace there's nothing to load, so loading is always false there.
  // Once a load has failed we are no longer "loading" — otherwise the badge
  // spins forever on a transient network blip.
  const loading =
    mode !== null && error === null && (routeShapes === null || stopsGeoJson === null);
  return { routeShapes, stopsGeoJson, loading, error, retry };
}

const MAX_LABEL_ROUTES = 6;

// Defends against React StrictMode double-effects and rapid mode flips
// handing back the same payload — without it, ~127 LIRR features re-do the
// label string ops on every call.
const enrichCache = new WeakMap<StopsGeoJSON, StopsGeoJSON>();

/** Augment each stop feature with derived properties consumed by map layer
 *  expressions: numeric `routeCount` for hub sizing/filtering, and a
 *  preformatted `labelText` ("Times Sq-42 St · 1 2 3 N Q R W") for the
 *  detailed label layer. Doing this once at load avoids reasoning about
 *  array operations inside MapLibre expressions. */
function enrichStops(stops: StopsGeoJSON): StopsGeoJSON {
  const cached = enrichCache.get(stops);
  if (cached) return cached;
  const enriched: StopsGeoJSON = {
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
  enrichCache.set(stops, enriched);
  return enriched;
}
