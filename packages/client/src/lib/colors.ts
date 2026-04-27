import { ROUTE_INFO, LIRR_ROUTE_GROUPS } from "@panoptrain/shared";
import type { Mode } from "@panoptrain/shared";

const DEFAULT_INFO = { color: "#808183", textColor: "#FFFFFF", isExpress: false };

/** routeId -> color/text for LIRR. LIRR doesn't have express service so
 *  isExpress is always false; text contrast on each branch color was picked
 *  to match the official MTA palette. */
const LIRR_LOOKUP: Record<string, { color: string; textColor: string; isExpress: boolean }> = {};
for (const g of LIRR_ROUTE_GROUPS) {
  for (const id of g.routes) {
    LIRR_LOOKUP[id] = { color: g.color, textColor: pickTextColor(g.color), isExpress: false };
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

export function getRouteInfo(
  routeId: string,
  mode: Mode = "subway",
): { color: string; textColor: string; isExpress: boolean } {
  if (mode === "lirr") {
    return LIRR_LOOKUP[routeId] ?? DEFAULT_INFO;
  }
  const info = ROUTE_INFO[routeId];
  if (!info) return DEFAULT_INFO;
  return { color: info.color, textColor: info.textColor, isExpress: info.isExpress };
}
