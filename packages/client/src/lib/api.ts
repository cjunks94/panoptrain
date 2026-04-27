import type { Mode, TrainsResponse, RoutesGeoJSON, StopsGeoJSON, PlanResponse } from "@panoptrain/shared";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTrains(mode: Mode, routes?: string[]): Promise<TrainsResponse> {
  const params = routes?.length ? `?routes=${routes.join(",")}` : "";
  return fetchJson<TrainsResponse>(`/${mode}/trains${params}`);
}

export function fetchRoutes(mode: Mode): Promise<RoutesGeoJSON> {
  return fetchJson<RoutesGeoJSON>(`/${mode}/routes`);
}

export function fetchStops(mode: Mode): Promise<StopsGeoJSON> {
  return fetchJson<StopsGeoJSON>(`/${mode}/stops`);
}

/** Trip planner is subway-only for now (PT-508). */
export function fetchPlan(fromIds: string[], toIds: string[]): Promise<PlanResponse> {
  const from = encodeURIComponent(fromIds.join(","));
  const to = encodeURIComponent(toIds.join(","));
  return fetchJson<PlanResponse>(`/plan?from=${from}&to=${to}`);
}
