import type { TrainsResponse, RoutesGeoJSON, StopsGeoJSON } from "@panoptrain/shared";

const BASE = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function fetchTrains(routes?: string[]): Promise<TrainsResponse> {
  const params = routes?.length ? `?routes=${routes.join(",")}` : "";
  return fetchJson<TrainsResponse>(`/trains${params}`);
}

export function fetchRoutes(): Promise<RoutesGeoJSON> {
  return fetchJson<RoutesGeoJSON>("/routes");
}

export function fetchStops(): Promise<StopsGeoJSON> {
  return fetchJson<StopsGeoJSON>("/stops");
}
