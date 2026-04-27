import { ROUTE_INFO, LIRR_ROUTE_GROUPS } from "@panoptrain/shared";
import type { Mode } from "@panoptrain/shared";

/** Identifier shown inside the train bullet on the map. For subway this is
 *  the route_id itself ("1", "L", "FX"). For LIRR — where riders never see
 *  the numeric GTFS IDs — we render a 2-letter branch abbreviation instead.
 *  Matches the marker shape's icon dimensions so 2 chars fit comfortably. */
const LIRR_LABELS: Record<string, string> = {
  "1": "BB",  // Babylon
  "2": "HM",  // Hempstead
  "3": "OB",  // Oyster Bay
  "4": "RK",  // Ronkonkoma
  "5": "MT",  // Montauk
  "6": "LB",  // Long Beach
  "7": "FR",  // Far Rockaway
  "8": "WH",  // West Hempstead
  "9": "PW",  // Port Washington
  "10": "PJ", // Port Jefferson (covers Huntington electric service too)
  "11": "BP", // Belmont Park
  "12": "CT", // City Terminal Zone
  "13": "GP", // Greenport
};

/** Marker glyph identifier emitted from useTrainFeatures and read by the
 *  map's symbol layer. Replaces the subway-flavoured `isExpress` boolean
 *  that used to leak into the layer config — modes can introduce their own
 *  shape variants without the layer needing to know about them. */
export type MarkerShape = "circle" | "square";

export interface RouteRender {
  color: string;
  textColor: string;
  /** Text rendered inside the marker bullet — branch abbrev for LIRR,
   *  route ID for subway. */
  label: string;
  /** Which SDF icon the marker layer should render. */
  markerShape: MarkerShape;
}

const DEFAULT_RENDER: RouteRender = {
  color: "#808183",
  textColor: "#FFFFFF",
  label: "?",
  markerShape: "circle",
};

const LIRR_LOOKUP: Record<string, RouteRender> = {};
for (const g of LIRR_ROUTE_GROUPS) {
  for (const id of g.routes) {
    LIRR_LOOKUP[id] = {
      color: g.color,
      textColor: pickTextColor(g.color),
      label: LIRR_LABELS[id] ?? id,
      markerShape: "circle",
    };
  }
}

/** Crude luminance heuristic — light bg gets dark text and vice versa. */
function pickTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#121212" : "#FFFFFF";
}

/** `mode` is required so call sites can't accidentally fall back to subway
 *  styling on an LIRR (or future mode) train. The TS compiler catches every
 *  call boundary; default-arg semantics would silently degrade. */
export function getRouteInfo(routeId: string, mode: Mode): RouteRender {
  if (mode === "lirr") {
    return LIRR_LOOKUP[routeId] ?? DEFAULT_RENDER;
  }
  const info = ROUTE_INFO[routeId];
  if (!info) return DEFAULT_RENDER;
  return {
    color: info.color,
    textColor: info.textColor,
    label: info.name,
    markerShape: info.isExpress ? "square" : "circle",
  };
}
