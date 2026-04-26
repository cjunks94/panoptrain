import type { TrainsResponse, RoutesGeoJSON, StopsGeoJSON, PlanResponse } from "@panoptrain/shared";

const BASE = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
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

export function fetchPlan(fromIds: string[], toIds: string[]): Promise<PlanResponse> {
  const from = encodeURIComponent(fromIds.join(","));
  const to = encodeURIComponent(toIds.join(","));
  return fetchJson<PlanResponse>(`/plan?from=${from}&to=${to}`);
}
