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
  const { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff } = useLineFilter(mode);
  // Default closed on mobile so the bottom sheet doesn't take up 75vh on
  // first paint — users land on the map, then tap to filter. Desktop keeps
  // the sidebar open by default since it doesn't cover the map.
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(max-width: 767px)").matches;
  });
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

  const { geojsonRef, interpolateFrame, trains } = useTrainFeatures(
    data, visibleRoutes, routeShapes, planRouteIds, mode,
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
        mode={mode}
        panelOpen={panelOpen}
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
