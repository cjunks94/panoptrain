import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TripPlan, LirrTripPlan, Mode } from "@panoptrain/shared";
import { AppShell } from "./components/Layout/AppShell.js";
import { TransitMap } from "./components/Map/TransitMap.js";
import { FilterPanel } from "./components/Panel/FilterPanel.js";
import { useTrainPositions } from "./hooks/useTrainPositions.js";
import { useTrainFeatures } from "./hooks/useTrainFeatures.js";
import { useRouteShapes } from "./hooks/useRouteShapes.js";
import { useLineFilter } from "./hooks/useLineFilter.js";
import { useView, transitModeFor } from "./hooks/useView.js";
import { useAircraftPositions } from "./hooks/useAircraftPositions.js";
import { useMetars } from "./hooks/useMetars.js";
import { MOBILE_QUERY } from "./hooks/useIsMobile.js";

export default function App() {
  const [view, setView] = useView();
  const transitMode = transitModeFor(view);
  // useLineFilter holds per-mode local state (no fetching). It needs *some*
  // Mode at all times even on the airspace view, since hooks can't be
  // skipped. Track the last transit mode the user was on and feed that
  // through; on airspace the line-filter UI is hidden anyway, so this is
  // just keeping the state object intact for the next subway/LIRR visit.
  const lastTransitModeRef = useRef<Mode>(transitMode ?? "subway");
  useEffect(() => {
    if (transitMode !== null) lastTransitModeRef.current = transitMode;
  }, [transitMode]);
  const lineFilterMode = transitMode ?? lastTransitModeRef.current;

  const { data, isStale, lastUpdated } = useTrainPositions(transitMode);
  const { routeShapes, stopsGeoJson, loading: routeShapesLoading } = useRouteShapes(transitMode);
  const { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff } = useLineFilter(lineFilterMode);
  const { aircraft } = useAircraftPositions(view === "airspace");
  // METAR feed only matters when the user can open an airport popup,
  // which only happens on the airspace tab. Same gate as aircraft.
  const { reports: metarReports } = useMetars(view === "airspace");
  // Default closed on mobile so the bottom sheet doesn't take up 75vh on
  // first paint — users land on the map, then tap to filter. Desktop keeps
  // the sidebar open by default since it doesn't cover the map. One-shot
  // matchMedia (not the reactive useIsMobile hook) so a desktop user
  // resizing down to mobile width doesn't have the panel slammed shut.
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia(MOBILE_QUERY).matches;
  });
  // Spotlight state accepts either subway or LIRR plans; downstream consumers
  // (planRouteIds memo, TransitMap) only read the shared subset of fields
  // (segments[].type, .routeId, .path), so a union is sufficient — no adapter
  // layer needed.
  const [planRoute, setPlanRoute] = useState<TripPlan | LirrTripPlan | null>(null);

  // Clear any active plan when the user switches off the transit view that
  // produced it — a subway plan is meaningless on LIRR, and neither plan is
  // meaningful on airspace.
  useEffect(() => {
    setPlanRoute(null);
  }, [transitMode]);

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
    data, visibleRoutes, routeShapes, planRouteIds, transitMode,
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
        mode={transitMode}
        panelOpen={panelOpen}
        routeShapesLoading={routeShapesLoading}
        aircraft={aircraft}
        metarReports={metarReports}
      />
      <FilterPanel
        open={panelOpen}
        onToggle={togglePanel}
        view={view}
        transitMode={transitMode}
        onViewChange={setView}
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
        aircraftCount={aircraft.length}
      />
    </AppShell>
  );
}
