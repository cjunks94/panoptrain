import { useState, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppShell } from "./components/Layout/AppShell.js";
import { TransitMap } from "./components/Map/TransitMap.js";
import { FilterPanel } from "./components/Panel/FilterPanel.js";
import { useTrainPositions } from "./hooks/useTrainPositions.js";
import { useAnimatedPositions } from "./hooks/useAnimatedPositions.js";
import { useRouteShapes } from "./hooks/useRouteShapes.js";
import { useLineFilter } from "./hooks/useLineFilter.js";

export default function App() {
  const { data, isStale, lastUpdated } = useTrainPositions();
  const animatedTrains = useAnimatedPositions(data);
  const { routeShapes, stopsGeoJson } = useRouteShapes();
  const { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff } = useLineFilter();
  const [panelOpen, setPanelOpen] = useState(true);

  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);

  return (
    <AppShell>
      <TransitMap
        trains={animatedTrains}
        routeShapes={routeShapes}
        stops={stopsGeoJson}
        visibleRoutes={visibleRoutes}
      />
      <FilterPanel
        open={panelOpen}
        onToggle={togglePanel}
        visibleRoutes={visibleRoutes}
        onToggleRoute={toggleRoute}
        onToggleGroup={toggleGroup}
        onAllOn={allOn}
        onAllOff={allOff}
        isStale={isStale}
        lastUpdated={lastUpdated}
        trainCount={data?.count ?? 0}
      />
    </AppShell>
  );
}
