import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import Map, { Source, Layer, Popup } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { RoutesGeoJSON, StopsGeoJSON, TripPlan } from "@panoptrain/shared";
import { ROUTE_INFO } from "@panoptrain/shared";
import type { TrainInfo } from "../../hooks/useTrainFeatures.js";
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
}

interface PopupInfo {
  train: TrainInfo;
  lng: number;
  lat: number;
}

export function TransitMap({ geojsonRef, interpolateFrame, trains, routeShapes, stops, planRoute }: TransitMapProps) {
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [iconsReady, setIconsReady] = useState(false);
  const mapRef = useRef<MapRef>(null);

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

  // Route shapes are always visible — toggles only control train visibility
  const allShapes = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!routeShapes) return null;
    return { type: "FeatureCollection", features: routeShapes.features };
  }, [routeShapes]);

  // Build GeoJSON for planned route highlight
  const planGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!planRoute) return null;
    const features = planRoute.segments
      .filter((s): s is Extract<typeof s, { type: "ride" }> => s.type === "ride" && s.path.length >= 2)
      .map((s) => ({
        type: "Feature" as const,
        properties: { routeId: s.routeId, color: ROUTE_INFO[s.routeId]?.color ?? "#fff" },
        geometry: { type: "LineString" as const, coordinates: s.path },
      }));
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

      {/* Planned route highlight */}
      {planGeoJson && (
        <Source id="plan-route" type="geojson" data={planGeoJson}>
          <Layer
            id="plan-route-outline"
            type="line"
            paint={{
              "line-color": "#ffffff",
              "line-width": 8,
              "line-opacity": 0.15,
            }}
          />
          <Layer
            id="plan-route-line"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": 5,
              "line-opacity": 0.9,
            }}
          />
        </Source>
      )}

      {/* Stations */}
      {stops && (
        <Source id="stops" type="geojson" data={stops}>
          <Layer
            id="station-dots"
            type="circle"
            paint={{
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                11, 1.5,
                14, 4,
                16, 6,
              ],
              "circle-color": "#ffffff",
              "circle-opacity": [
                "interpolate", ["linear"], ["zoom"],
                11, 0.3,
                13, 0.6,
                15, 0.9,
              ],
              "circle-stroke-width": [
                "interpolate", ["linear"], ["zoom"],
                11, 0,
                14, 1,
              ],
              "circle-stroke-color": "#999",
              "circle-stroke-opacity": 0.5,
            }}
            minzoom={11}
          />
          <Layer
            id="station-labels"
            type="symbol"
            minzoom={14}
            layout={{
              "text-field": ["get", "stopName"],
              "text-size": [
                "interpolate", ["linear"], ["zoom"],
                14, 10,
                16, 13,
              ],
              "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
              "text-offset": [0, 1.2],
              "text-anchor": "top",
              "text-max-width": 8,
              "text-optional": true,
            }}
            paint={{
              "text-color": "#ccc",
              "text-halo-color": "#1a1a2e",
              "text-halo-width": 1.5,
              "text-opacity": [
                "interpolate", ["linear"], ["zoom"],
                14, 0.6,
                16, 1,
              ],
            }}
          />
        </Source>
      )}

      {/* Train markers — data pushed by RAF loop via source.setData() */}
      <Source id="trains" type="geojson" data={geojsonRef.current}>
        {/* Glow layer (underneath) */}
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
              "icon-opacity": ["get", "opacity"],
              "text-color": ["get", "textColor"],
              "text-opacity": ["get", "opacity"],
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
