import { ROUTE_INFO } from "@panoptrain/shared";

const DEFAULT_INFO = { color: "#808183", textColor: "#FFFFFF", isExpress: false };

export function getRouteInfo(routeId: string): { color: string; textColor: string; isExpress: boolean } {
  const info = ROUTE_INFO[routeId];
  if (!info) return DEFAULT_INFO;
  return { color: info.color, textColor: info.textColor, isExpress: info.isExpress };
}
