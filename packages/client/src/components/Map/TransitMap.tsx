import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Map, { Source, Layer, Popup } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { Mode, RoutesGeoJSON, StopsGeoJSON, TripPlan } from "@panoptrain/shared";
import { ROUTE_INFO } from "@panoptrain/shared";
import type { TrainInfo } from "../../hooks/useTrainFeatures.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { GeoJSON } from "geojson";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const NYC_CENTER = { longitude: -73.98, latitude: 40.75, zoom: 12 };
const FRAME_INTERVAL = 66; // ~15fps

/** Generate a filled circle as SDF-compatible ImageData */
function createCircleIcon(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** Generate a rounded square as SDF-compatible ImageData */
function createSquareIcon(size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const pad = 1;
  const corner = size * 0.15;
  ctx.beginPath();
  ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, corner);
  ctx.fillStyle = "#fff";
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

interface TransitMapProps {
  geojsonRef: React.MutableRefObject<GeoJSON.FeatureCollection>;
  interpolateFrame: () => void;
  trains: TrainInfo[];
  routeShapes: RoutesGeoJSON | null;
  stops: StopsGeoJSON | null;
  planRoute: TripPlan | null;
  /** When set, hide all non-plan route lines and pulse the plan outline. */
  planRouteIds: Set<string> | null;
  /** Active transit mode. Drives auto-fit on mode switch and per-mode line
   *  styling. */
  mode: Mode;
  /** Whether the filter panel is open. Auto-fit padding compensates for
   *  the visible panel: 320px on the left when open on desktop, 75vh
   *  bottom sheet on mobile. */
  panelOpen: boolean;
}

interface PopupInfo {
  train: TrainInfo;
  lng: number;
  lat: number;
}

export function TransitMap({ geojsonRef, interpolateFrame, trains, routeShapes, stops, planRoute, planRouteIds, mode, panelOpen }: TransitMapProps) {
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [iconsReady, setIconsReady] = useState(false);
  const mapRef = useRef<MapRef>(null);
  const isMobile = useIsMobile();

  // fitBounds padding compensates for whichever piece of UI is currently
  // covering the map. On desktop with panel open, that's 320px on the left.
  // On mobile, the panel is a bottom sheet at ~75vh — so when open we pad
  // the bottom heavily and zero out the left. Hardcoding 320px on the left
  // for all viewports leaves ~70px of usable map width on a 390px iPhone,
  // which the auto-fit then crams the whole network into.
  const fitPadding = useMemo(() => {
    if (!panelOpen) return { top: 60, bottom: 60, left: 60, right: 60 };
    if (isMobile) {
      // 75vh sheet plus a little extra so the fitted bbox doesn't touch the
      // sheet's top edge. Math: sheet eats 75% of viewport-height; the map
      // area above is ~25vh. Use a conservative ~520px estimate that works
      // across phone sizes (380-430px wide × 700-900px tall).
      return { top: 60, bottom: 520, left: 30, right: 30 };
    }
    return { top: 60, bottom: 60, left: 320, right: 60 };
  }, [isMobile, panelOpen]);

  // RAF loop — interpolates coordinates and pushes directly to MapLibre (no React renders)
  useEffect(() => {
    let rafId = 0;
    let lastFrame = 0;

    const animate = () => {
      const now = Date.now();
      if (now - lastFrame >= FRAME_INTERVAL) {
        lastFrame = now;
        interpolateFrame();
        const map = mapRef.current?.getMap();
        const source = map?.getSource("trains");
        if (source && "setData" in source) {
          (source as { setData: (data: GeoJSON.FeatureCollection) => void }).setData(geojsonRef.current);
        }
      }
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [geojsonRef, interpolateFrame]);

  const handleMapLoad = useCallback((e: { target: ReturnType<MapRef["getMap"]> }) => {
    const map = e.target;
    const size = 48;
    map.addImage("marker-circle", createCircleIcon(size), { sdf: true });
    map.addImage("marker-square", createSquareIcon(size), { sdf: true });
    setIconsReady(true);
  }, []);

  // Auto-fit the viewport to the active mode's network on mode switch (PT-507).
  // Subway → NYC; LIRR → Long Island. Without this, switching to LIRR leaves
  // the user staring at Manhattan with the network entirely off-screen.
  //
  // Deps are [routeShapes] alone — NOT [mode, routeShapes]. When the user
  // flips mode, React commits the new mode prop one render before
  // useRouteShapes can finish its setRouteShapes(null) reset, so for one
  // render `routeShapes` is the previous mode's data while `mode` is the new
  // one. With mode in the deps the effect would fire here and fit to the
  // OLD bbox under the NEW mode name — switching to LIRR would zoom the map
  // to NYC and vice versa. Excluding mode means the effect only fires when
  // routeShapes itself actually changes (after the reset, then again when
  // the new mode's data arrives), and the closure picks up the matching
  // mode at that moment.
  const lastFitMode = useRef<Mode | null>(null);
  useEffect(() => {
    if (!routeShapes || routeShapes.features.length === 0) return;
    if (lastFitMode.current === null) {
      // First time we have routes — record this as the seed mode and let
      // initialViewState own the camera.
      lastFitMode.current = mode;
      return;
    }
    if (lastFitMode.current === mode) return;

    const map = mapRef.current?.getMap();
    if (!map) return;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const feature of routeShapes.features) {
      for (const [lon, lat] of feature.geometry.coordinates) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (minLon === Infinity) return;
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      padding: fitPadding,
      duration: 800,
      maxZoom: 12,
    });
    lastFitMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mode + fitPadding intentionally excluded; only routeShapes drives fit
  }, [routeShapes]);

  // Auto-fit the viewport to the planned route so users immediately see the
  // whole trip — fixes the case where one segment goes off-screen (e.g. an
  // L-line ride heading east into Brooklyn while the user is zoomed on
  // Manhattan). Padding compensates for the filter panel — see fitPadding
  // above.
  useEffect(() => {
    if (!planRoute) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const seg of planRoute.segments) {
      if (seg.type !== "ride") continue;
      for (const [lon, lat] of seg.path) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (minLon === Infinity) return;
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      padding: fitPadding,
      duration: 800,
      maxZoom: 14,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only planRoute drives this fit; fitPadding read at fit time
  }, [planRoute]);

  // Pulse the plan-route-outline AND the plan-stop halos in lockstep when a
  // plan is active. Uses a sine wave on opacity + size so the white halo
  // "breathes". No-op when there's no plan; unsubscribes cleanly on change.
  useEffect(() => {
    if (!planRoute) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      const phase = (Math.sin(t * 1.8) + 1) / 2; // 0..1

      // Wide blurry outer halo
      const outerOpacity = 0.30 + 0.35 * phase; // 0.30..0.65
      const outerWidth = 16 + 8 * phase;        // 16..24
      if (map.getLayer("plan-route-outline")) {
        map.setPaintProperty("plan-route-outline", "line-opacity", outerOpacity);
        map.setPaintProperty("plan-route-outline", "line-width", outerWidth);
      }

      // Station halos — slightly stronger pulse so they stand out from line
      const stopOpacity = 0.25 + 0.40 * phase;       // 0.25..0.65
      const stopRadiusBase = 14 + 8 * phase;         // 14..22  (start/end)
      const stopRadiusTransfer = 10 + 6 * phase;     // 10..16  (transfer)
      if (map.getLayer("plan-stops-glow")) {
        map.setPaintProperty("plan-stops-glow", "circle-opacity", stopOpacity);
        map.setPaintProperty("plan-stops-glow", "circle-radius", [
          "match",
          ["get", "kind"],
          "transfer", stopRadiusTransfer,
          stopRadiusBase,
        ]);
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [planRoute]);

  // Route shapes are always visible — toggles only control train visibility
  const allShapes = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!routeShapes) return null;
    return { type: "FeatureCollection", features: routeShapes.features };
  }, [routeShapes]);

  // Build GeoJSON for planned route highlight. Each ride becomes a colored
  // line; between consecutive rides we add a short white "transfer connector"
  // that bridges the geometric gap where two perpendicular subway lines meet
  // at a transfer station (e.g. N going south meeting L going east at
  // 14 St-Union Sq). Without this the user sees a visual gap at every
  // transfer.
  const planGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!planRoute) return null;
    const rides = planRoute.segments.filter(
      (s): s is Extract<typeof s, { type: "ride" }> => s.type === "ride" && s.path.length >= 2,
    );
    if (rides.length === 0) return null;

    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < rides.length; i++) {
      const r = rides[i];
      features.push({
        type: "Feature",
        properties: {
          routeId: r.routeId,
          color: ROUTE_INFO[r.routeId]?.color ?? "#fff",
          isTransfer: false,
        },
        geometry: { type: "LineString", coordinates: r.path },
      });
      if (i < rides.length - 1) {
        const next = rides[i + 1];
        features.push({
          type: "Feature",
          properties: { routeId: "transfer", color: "#ffffff", isTransfer: true },
          geometry: {
            type: "LineString",
            coordinates: [r.path[r.path.length - 1], next.path[0]],
          },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [planRoute]);

  // Plan key stations: start (first ride's board), end (last ride's alight),
  // transfers (each boundary between consecutive ride segments). We pull
  // coordinates straight from each segment's path geometry instead of looking
  // up by stopId — segments use platform-level IDs (e.g. "127S") which the
  // /api/stops payload (parent stops only) doesn't include.
  const planStopsGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!planRoute) return null;
    const rides = planRoute.segments.filter(
      (s): s is Extract<typeof s, { type: "ride" }> => s.type === "ride" && s.path.length >= 2,
    );
    if (rides.length === 0) return null;

    const features: GeoJSON.Feature[] = [];
    const firstRide = rides[0];
    const lastRide = rides[rides.length - 1];

    features.push({
      type: "Feature",
      properties: { kind: "start", stopName: firstRide.boardAt.stopName },
      geometry: { type: "Point", coordinates: firstRide.path[0] },
    });

    for (let i = 0; i < rides.length - 1; i++) {
      const ride = rides[i];
      features.push({
        type: "Feature",
        properties: { kind: "transfer", stopName: ride.alightAt.stopName },
        geometry: { type: "Point", coordinates: ride.path[ride.path.length - 1] },
      });
    }

    features.push({
      type: "Feature",
      properties: { kind: "end", stopName: lastRide.alightAt.stopName },
      geometry: { type: "Point", coordinates: lastRide.path[lastRide.path.length - 1] },
    });

    return { type: "FeatureCollection", features };
  }, [planRoute]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) {
        setPopup(null);
        return;
      }
      const props = feature.properties;
      const train = trains.find((t) => t.tripId === props.tripId);
      if (train) {
        // Use animated position from GeoJSON feature
        const geoFeature = geojsonRef.current.features.find(
          (f) => f.properties?.tripId === props.tripId,
        );
        const coords = geoFeature?.geometry && "coordinates" in geoFeature.geometry
          ? geoFeature.geometry.coordinates as [number, number]
          : [train.longitude, train.latitude];
        setPopup({ train, lng: coords[0], lat: coords[1] });
      }
    },
    [trains, geojsonRef],
  );

  return (
    <Map
      ref={mapRef}
      initialViewState={NYC_CENTER}
      style={{ width: "100%", height: "100%" }}
      mapStyle={BASEMAP}
      interactiveLayerIds={["train-markers"]}
      onClick={handleClick}
      onLoad={handleMapLoad}
      cursor="pointer"
    >
      {/* Route lines — when a plan is active, hide every line that isn't on
          one of the planned routes so the user's chosen path stands alone.
          LIRR rails render slightly thicker than subway to match the
          commuter-rail convention and because LIRR's much-larger geographic
          spread means each line renders at lower screen-space density. */}
      {allShapes && (
        <Source id="routes" type="geojson" data={allShapes}>
          <Layer
            id="route-lines"
            type="line"
            filter={planRouteIds
              ? ["in", ["get", "routeId"], ["literal", Array.from(planRouteIds)]]
              : ["literal", true]
            }
            paint={{
              "line-color": ["get", "color"],
              "line-width": mode === "lirr" ? 3.5 : 2.5,
              "line-opacity": mode === "lirr" ? 0.85 : 0.6,
            }}
          />
        </Source>
      )}

      {/* Planned route highlight — outline + colored line. Outline pulses
          (driven by the RAF effect above). The colored line is bumped to
          width 6 and uses a line-cap of "round" so adjacent segments meet
          cleanly through transfer points. */}
      {planGeoJson && (
        <Source id="plan-route" type="geojson" data={planGeoJson}>
          {/* Wide soft white glow underneath — visible even when the route's
              own color is low-contrast against the dark map (e.g. L grey). */}
          <Layer
            id="plan-route-outline"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#ffffff",
              "line-width": 18,
              "line-opacity": 0.35,
              "line-blur": 4,
            }}
          />
          {/* Inner white core — guarantees the path is readable regardless of
              the route's color. The colored layer on top tints it. */}
          <Layer
            id="plan-route-core"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#ffffff",
              "line-width": 8,
              "line-opacity": 0.85,
            }}
          />
          <Layer
            id="plan-route-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 5,
              "line-opacity": 1,
            }}
          />
        </Source>
      )}

      {/* Stations */}
      {stops && (
        <Source id="stops" type="geojson" data={stops}>
          {/* Station markers — radius scales with serving-route count so
              major hubs stand out. Every dot gets a dark halo so the white
              core punches through against colored route lines beneath. */}
          <Layer
            id="station-dots"
            type="circle"
            paint={{
              // Dot size + halo scale with the API-emitted `importance`
              // bucket (0/1/2). Per-mode thresholds live server-side so
              // subway's "8+ routes = hub" logic doesn't dictate LIRR
              // (where Jamaica + Penn matter regardless of count).
              //
              // `coalesce` defaults missing `importance` to 0 — the field
              // was added in this PR and /api/<mode>/stops is cached for
              // 24h; any client with a pre-deploy cached payload would
              // otherwise see every == check evaluate false and render
              // every station at the smallest size.
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                11, [
                  "case",
                  ["==", ["coalesce", ["get", "importance"], 0], 2], 4,
                  ["==", ["coalesce", ["get", "importance"], 0], 1], 2.5,
                  2,
                ],
                14, [
                  "case",
                  ["==", ["coalesce", ["get", "importance"], 0], 2], 7,
                  ["==", ["coalesce", ["get", "importance"], 0], 1], 5,
                  4,
                ],
                16, [
                  "case",
                  ["==", ["coalesce", ["get", "importance"], 0], 2], 9,
                  ["==", ["coalesce", ["get", "importance"], 0], 1], 7,
                  6,
                ],
              ],
              "circle-color": "#ffffff",
              "circle-opacity": [
                "interpolate", ["linear"], ["zoom"],
                11, 0.85,
                13, 1,
              ],
              "circle-stroke-width": [
                "interpolate", ["linear"], ["zoom"],
                11, [
                  "case",
                  ["==", ["coalesce", ["get", "importance"], 0], 2], 2,
                  ["==", ["coalesce", ["get", "importance"], 0], 1], 1.5,
                  1,
                ],
                14, [
                  "case",
                  ["==", ["coalesce", ["get", "importance"], 0], 2], 2.5,
                  ["==", ["coalesce", ["get", "importance"], 0], 1], 1.8,
                  1.2,
                ],
              ],
              // Dark halo for normal stations (separates from colored routes);
              // bright halo for hubs to make them visually "premium".
              "circle-stroke-color": [
                "case",
                ["==", ["coalesce", ["get", "importance"], 0], 2], "#ffffff",
                "#0a0a1a",
              ],
              "circle-stroke-opacity": 1,
            }}
            minzoom={11}
          />

          {/* Major-hub labels — shown earlier so the map is readable at
              default zoom. Filter on importance >= 1: subway suppresses
              local stops at this zoom (avoids clutter); LIRR shows every
              station because its network is geographically sparse and 127
              stations spread over 100+ miles need labels at wider zooms. */}
          <Layer
            id="station-labels-major"
            type="symbol"
            minzoom={12}
            maxzoom={14}
            filter={[">=", ["coalesce", ["get", "importance"], 0], 1]}
            layout={{
              "text-field": ["get", "stopName"],
              "text-size": [
                "interpolate", ["linear"], ["zoom"],
                12, 9,
                14, 11,
              ],
              "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
              "text-offset": [0, 1.0],
              "text-anchor": "top",
              "text-max-width": 8,
              "text-optional": true,
              "symbol-sort-key": ["-", 0, ["coalesce", ["get", "importance"], 0]],
            }}
            paint={{
              "text-color": "#d8d8e0",
              "text-halo-color": "#1a1a2e",
              "text-halo-width": 1.5,
              "text-opacity": [
                "interpolate", ["linear"], ["zoom"],
                12, 0.5,
                14, 0.85,
              ],
            }}
          />

          {/* Detailed labels — at zoom 14+, every station shows its name plus
              the routes serving it (PT-203). Sorted by importance so hubs win
              collision contests. */}
          <Layer
            id="station-labels-detailed"
            type="symbol"
            minzoom={14}
            layout={{
              "text-field": ["get", "labelText"],
              "text-size": [
                "interpolate", ["linear"], ["zoom"],
                14, 10,
                16, 12,
              ],
              "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-max-width": 10,
              "text-optional": true,
              "symbol-sort-key": ["-", 0, ["coalesce", ["get", "importance"], 0]],
            }}
            paint={{
              "text-color": "#d8d8e0",
              "text-halo-color": "#1a1a2e",
              "text-halo-width": 1.5,
              "text-opacity": [
                "interpolate", ["linear"], ["zoom"],
                14, 0.7,
                16, 1,
              ],
            }}
          />
        </Source>
      )}

      {/* Plan key stations — pulsing halo + solid center on the start, end,
          and any transfer points along the active plan. Pulse params live
          in the RAF effect above. */}
      {planStopsGeoJson && (
        <Source id="plan-stops" type="geojson" data={planStopsGeoJson}>
          <Layer
            id="plan-stops-glow"
            type="circle"
            paint={{
              "circle-radius": 18,
              "circle-color": "#ffffff",
              "circle-opacity": 0.4,
              "circle-blur": 0.6,
            }}
          />
          <Layer
            id="plan-stops-center"
            type="circle"
            paint={{
              "circle-radius": [
                "match",
                ["get", "kind"],
                "transfer", 4,
                6,
              ],
              "circle-color": "#ffffff",
              "circle-opacity": 1,
              "circle-stroke-width": [
                "match",
                ["get", "kind"],
                "transfer", 1.5,
                2.5,
              ],
              "circle-stroke-color": [
                "match",
                ["get", "kind"],
                "transfer", "#cbd5e1",
                "#0a0a1a",
              ],
            }}
          />
        </Source>
      )}

      {/* Train markers — data pushed by RAF loop via source.setData(). The
          source is declared last so its layers render on top of routes,
          stops, and plan highlights. */}
      <Source id="trains" type="geojson" data={geojsonRef.current}>
        {/* Soft outer glow */}
        <Layer
          id="train-glow"
          type="circle"
          paint={{
            "circle-radius": 14,
            "circle-color": ["get", "color"],
            "circle-opacity": ["*", 0.2, ["get", "opacity"]],
            "circle-blur": 1,
          }}
        />
        {/* Dark rim — same SDF icons as the marker but slightly larger and
            dark-tinted, drawn underneath. The 0.55-vs-0.50 size delta shows
            as a 1-2px dark ring around the colored bullet so trains stand
            out against same-colored route lines beneath them. We use a
            symbol layer (not circle) because circle-translate doesn't
            support data-driven expressions, so cluster fan-out can only be
            mirrored via icon-offset.
            icon-offset is multiplied by icon-size for the final screen
            offset, so the rim's offset values are scaled down to match the
            marker's screen position: 78px / 0.55 ≈ 142. */}
        {iconsReady && (
          <Layer
            id="train-rim"
            type="symbol"
            layout={{
              "icon-image": ["get", "iconImage"],
              "icon-size": 0.55,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-offset": [
                "interpolate", ["linear"], ["get", "clusterOffset"],
                -3, ["literal", [-142, 0]],
                0, ["literal", [0, 0]],
                3, ["literal", [142, 0]],
              ] as any,
            }}
            paint={{
              "icon-color": "#0a0a1a",
              "icon-opacity": ["*", 0.95, ["get", "opacity"]],
            }}
          />
        )}
        {/* Route bullet — colored shape with route label inside. Both
            iconImage (circle/square) and label come from per-mode feature
            properties so the layer config is mode-agnostic. */}
        {iconsReady && (
          <Layer
            id="train-markers"
            type="symbol"
            layout={{
              "icon-image": ["get", "iconImage"],
              "icon-size": 0.5,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-offset": [
                "interpolate", ["linear"], ["get", "clusterOffset"],
                -3, ["literal", [-156, 0]],
                0, ["literal", [0, 0]],
                3, ["literal", [156, 0]],
              ] as any,
              "text-field": ["get", "label"],
              "text-size": 11,
              "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "text-offset": [
                "interpolate", ["linear"], ["get", "clusterOffset"],
                -3, ["literal", [-7.09, 0]],
                0, ["literal", [0, 0]],
                3, ["literal", [7.09, 0]],
              ] as any,
            }}
            paint={{
              "icon-color": ["get", "color"],
              "icon-opacity": ["get", "opacity"],
              "text-color": ["get", "textColor"],
              "text-opacity": ["get", "opacity"],
              // Halo around the route number so it stays readable even if
              // the icon is rendered against a same-color route line.
              "text-halo-color": "#0a0a1a",
              "text-halo-width": 1,
            }}
          />
        )}
        {/* Direction carets — rotated by actual bearing along the track */}
        <Layer
          id="train-carets"
          type="symbol"
          layout={{
            "text-field": "▲",
            "text-size": 10,
            "text-offset": [
              "interpolate", ["linear"], ["get", "clusterOffset"],
              -3, ["literal", [-7.8, -1.5]],
              0, ["literal", [0, -1.5]],
              3, ["literal", [7.8, -1.5]],
            ] as any,
            "text-rotate": ["get", "bearing"],
            "text-rotation-alignment": "map",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-opacity": ["*", 0.85, ["get", "opacity"]],
          }}
        />
      </Source>

      {/* Popup on click */}
      {popup && (
        <Popup
          longitude={popup.lng}
          latitude={popup.lat}
          onClose={() => setPopup(null)}
          anchor="bottom"
          closeButton={true}
          closeOnClick={false}
          style={{ maxWidth: 240 }}
        >
          <div style={{ color: "#1a1a2e", fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: popup.train.color,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {popup.train.routeId}
              </span>
              <strong>{popup.train.destination}</strong>
            </div>
            <div>
              {popup.train.status === "STOPPED_AT"
                ? `At ${popup.train.currentStopName}`
                : `En route to ${popup.train.currentStopName}`}
            </div>
            {popup.train.delay !== null && popup.train.delay !== 0 && (
              <div style={{ color: popup.train.delay > 0 ? "#dc2626" : "#16a34a" }}>
                {popup.train.delay > 0
                  ? `${Math.round(popup.train.delay / 60)} min late`
                  : `${Math.abs(Math.round(popup.train.delay / 60))} min early`}
              </div>
            )}
          </div>
        </Popup>
      )}
    </Map>
  );
}
