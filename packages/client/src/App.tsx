import { useState, useCallback } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { AppShell } from "./components/Layout/AppShell.js";
import { TransitMap } from "./components/Map/TransitMap.js";
import { FilterPanel } from "./components/Panel/FilterPanel.js";
import { useTrainPositions } from "./hooks/useTrainPositions.js";
import { useTrainFeatures } from "./hooks/useTrainFeatures.js";
import { useRouteShapes } from "./hooks/useRouteShapes.js";
import { useLineFilter } from "./hooks/useLineFilter.js";

export default function App() {
  const { data, isStale, lastUpdated } = useTrainPositions();
  const { routeShapes, stopsGeoJson } = useRouteShapes();
  const { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff } = useLineFilter();
  const { geojsonRef, interpolateFrame, trains } = useTrainFeatures(data, visibleRoutes);
  const [panelOpen, setPanelOpen] = useState(true);

  const togglePanel = useCallback(() => setPanelOpen((p) => !p), []);

  return (
    <AppShell>
      <TransitMap
        geojsonRef={geojsonRef}
        interpolateFrame={interpolateFrame}
        trains={trains}
        routeShapes={routeShapes}
        stops={stopsGeoJson}
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
