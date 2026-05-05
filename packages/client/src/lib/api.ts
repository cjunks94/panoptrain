import type {
  Mode,
  TrainsResponse,
  RoutesGeoJSON,
  StopsGeoJSON,
  PlanResponse,
  LirrPlanResponse,
} from "@panoptrain/shared";

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

/** Subway trip planner — uses an adjacency graph and surfaces minute durations
 *  (subway service is frequent enough that absolute times aren't useful). */
export function fetchPlan(fromIds: string[], toIds: string[]): Promise<PlanResponse> {
  const from = encodeURIComponent(fromIds.join(","));
  const to = encodeURIComponent(toIds.join(","));
  return fetchJson<PlanResponse>(`/plan?from=${from}&to=${to}`);
}

/** LIRR trip planner — schedule-based, returns concrete next-train itineraries
 *  (e.g. "Board 6:47 train, arrive 7:23"). `at` defaults to now on the server. */
export function fetchLirrPlan(
  fromIds: string[],
  toIds: string[],
  at?: Date,
): Promise<LirrPlanResponse> {
  const from = encodeURIComponent(fromIds.join(","));
  const to = encodeURIComponent(toIds.join(","));
  const atParam = at ? `&at=${encodeURIComponent(at.toISOString())}` : "";
  return fetchJson<LirrPlanResponse>(`/plan/lirr?from=${from}&to=${to}${atParam}`);
}
