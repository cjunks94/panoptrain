import { useState, useCallback, useMemo } from "react";
import Map, { Source, Layer, Popup } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { RoutesGeoJSON, StopsGeoJSON } from "@panoptrain/shared";
import type { AnimatedTrain } from "../../hooks/useAnimatedPositions.js";
import type { GeoJSON } from "geojson";

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const NYC_CENTER = { longitude: -73.98, latitude: 40.75, zoom: 12 };

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
  trains: AnimatedTrain[];
  routeShapes: RoutesGeoJSON | null;
  stops: StopsGeoJSON | null;
  visibleRoutes: Set<string>;
}

interface PopupInfo {
  train: AnimatedTrain;
  lng: number;
  lat: number;
}

export function TransitMap({ trains, routeShapes, stops, visibleRoutes }: TransitMapProps) {
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [iconsReady, setIconsReady] = useState(false);

  // Build GeoJSON for train markers:
  // 1. Dedupe stopped trains — one marker per route per stop
  // 2. Fan out remaining overlaps horizontally
  const trainsGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    const visible = trains.filter((t) => visibleRoutes.has(t.routeId));

    // Deduplicate: within each ~50m grid cell, keep one train per route.
    // At terminals, many trains pile up with various statuses (STOPPED_AT,
    // INCOMING_AT, IN_TRANSIT_TO) — all interpolated to the same position.
    const DEDUP_GRID = 0.0005; // ~50m
    const seenRouteAtGrid = new Set<string>();
    const deduped = visible.filter((t) => {
      const gx = Math.round(t.longitude / DEDUP_GRID);
      const gy = Math.round(t.latitude / DEDUP_GRID);
      const key = `${gx},${gy}-${t.routeId}`;
      if (seenRouteAtGrid.has(key)) return false;
      seenRouteAtGrid.add(key);
      return true;
    });

    const features = deduped.map((t) => ({
      type: "Feature" as const,
      properties: {
        tripId: t.tripId,
        routeId: t.routeId,
        color: t.color,
        textColor: t.textColor,
        isExpress: t.isExpress,
        direction: t.direction,
        bearing: t.bearing ?? (t.direction === 0 ? 0 : 180),
        status: t.status,
        destination: t.destination,
        currentStopName: t.currentStopName,
        nextStopName: t.nextStopName ?? "",
        delay: t.delay ?? 0,
        clusterOffset: 0,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [t.longitude, t.latitude],
      },
    }));

    // Detect remaining overlaps and assign pixel offsets to fan them out
    const GRID = 0.0005; // ~50m snap for proximity grouping
    const groups: Record<string, number[]> = {};
    for (let i = 0; i < features.length; i++) {
      const [lon, lat] = features[i].geometry.coordinates;
      const key = `${Math.round(lon / GRID)},${Math.round(lat / GRID)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(i);
    }
    for (const indices of Object.values(groups)) {
      if (indices.length <= 1) continue;
      const center = (indices.length - 1) / 2;
      for (let j = 0; j < indices.length; j++) {
        features[indices[j]].properties.clusterOffset = j - center;
      }
    }

    return { type: "FeatureCollection", features };
  }, [trains, visibleRoutes]);

  const handleMapLoad = useCallback((e: { target: ReturnType<MapRef["getMap"]> }) => {
    const map = e.target;
    const size = 48;
    map.addImage("marker-circle", createCircleIcon(size), { sdf: true });
    map.addImage("marker-square", createSquareIcon(size), { sdf: true });
    setIconsReady(true);
  }, []);

  // Route shapes are always visible — toggles only control train visibility
  const allShapes = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!routeShapes) return null;
    return { type: "FeatureCollection", features: routeShapes.features };
  }, [routeShapes]);

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
        setPopup({ train, lng: train.longitude, lat: train.latitude });
      }
    },
    [trains],
  );

  return (
    <Map
      initialViewState={NYC_CENTER}
      style={{ width: "100%", height: "100%" }}
      mapStyle={BASEMAP}
      interactiveLayerIds={["train-markers"]}
      onClick={handleClick}
      onLoad={handleMapLoad}
      cursor="pointer"
    >
      {/* Route lines */}
      {allShapes && (
        <Source id="routes" type="geojson" data={allShapes}>
          <Layer
            id="route-lines"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": 2.5,
              "line-opacity": 0.6,
            }}
          />
        </Source>
      )}

      {/* Station dots */}
      {stops && (
        <Source id="stops" type="geojson" data={stops}>
          <Layer
            id="station-dots"
            type="circle"
            paint={{
              "circle-radius": 2,
              "circle-color": "#555",
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "#777",
            }}
            minzoom={13}
          />
        </Source>
      )}

      {/* Train markers */}
      <Source id="trains" type="geojson" data={trainsGeoJson}>
        {/* Glow layer (underneath) */}
        <Layer
          id="train-glow"
          type="circle"
          paint={{
            "circle-radius": 14,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.2,
            "circle-blur": 1,
          }}
        />
        {/* Route bullet — colored circle (local) or square (express) with route letter */}
        {iconsReady && (
          <Layer
            id="train-markers"
            type="symbol"
            layout={{
              "icon-image": ["case", ["get", "isExpress"], "marker-square", "marker-circle"],
              "icon-size": 0.5,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-offset": [
                "interpolate", ["linear"], ["get", "clusterOffset"],
                -3, ["literal", [-156, 0]],
                0, ["literal", [0, 0]],
                3, ["literal", [156, 0]],
              ] as any,
              "text-field": ["get", "routeId"],
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
              "icon-halo-color": "#ffffff",
              "icon-halo-width": 1,
              "text-color": ["get", "textColor"],
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
            "text-opacity": 0.85,
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
