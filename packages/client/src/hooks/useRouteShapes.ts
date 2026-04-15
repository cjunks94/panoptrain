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
          setStopsGeoJson(stops);
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
