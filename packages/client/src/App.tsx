import { useState, useCallback, useMemo } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TripPlan } from "@panoptrain/shared";
import { AppShell } from "./components/Layout/AppShell.js";
import { TransitMap } from "./components/Map/TransitMap.js";
import { FilterPanel } from "./components/Panel/FilterPanel.js";
import { useTrainPositions } from "./hooks/useTrainPositions.js";
import { useTrainFeatures } from "./hooks/useTrainFeatures.js";
import { useRouteShapes } from "./hooks/useRouteShapes.js";
import { useLineFilter } from "./hooks/useLineFilter.js";
import { useMode } from "./hooks/useMode.js";

export default function App() {
  const [mode, setMode] = useMode();
  const { data, isStale, lastUpdated } = useTrainPositions(mode);
  const { routeShapes, stopsGeoJson } = useRouteShapes(mode);
  const { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff } = useLineFilter();
  const [panelOpen, setPanelOpen] = useState(true);
  const [planRoute, setPlanRoute] = useState<TripPlan | null>(null);

  // When a plan is active, surface only the routes that plan rides — these
  // are the trains we want to spotlight on the map (PT-309).
  const planRouteIds = useMemo<Set<string> | null>(() => {
    if (!planRoute) return null;
    const ids = new Set<string>();
    for (const seg of planRoute.segments) {
      if (seg.type === "ride") ids.add(seg.routeId);
    }
    return ids;
  }, [planRoute]);

  // Route-filter chips only exist for subway (PT-506 will add LIRR groups).
  // On LIRR, bypass the filter by passing a synthetic "all routes" set so
  // every train shows.
  const effectiveVisibleRoutes = useMemo(() => {
    if (mode === "subway") return visibleRoutes;
    return new Set((data?.trains ?? []).map((t) => t.routeId));
  }, [mode, visibleRoutes, data]);

  const { geojsonRef, interpolateFrame, trains } = useTrainFeatures(
    data, effectiveVisibleRoutes, routeShapes, planRouteIds,
  );

  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);

  return (
    <AppShell>
      <TransitMap
        geojsonRef={geojsonRef}
        interpolateFrame={interpolateFrame}
        trains={trains}
        routeShapes={routeShapes}
        stops={stopsGeoJson}
        planRoute={planRoute}
        planRouteIds={planRouteIds}
      />
      <FilterPanel
        open={panelOpen}
        onToggle={togglePanel}
        mode={mode}
        onModeChange={setMode}
        visibleRoutes={visibleRoutes}
        onToggleRoute={toggleRoute}
        onToggleGroup={toggleGroup}
        onAllOn={allOn}
        onAllOff={allOff}
        isStale={isStale}
        lastUpdated={lastUpdated}
        trainCount={data?.count ?? 0}
        stops={stopsGeoJson}
        liveTrains={data?.trains ?? []}
        onPlanFound={setPlanRoute}
      />
    </AppShell>
  );
}
