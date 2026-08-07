import {
  type Mode,
  type TrainsResponse,
  type RoutesGeoJSON,
  type StopsGeoJSON,
  type PlanResponse,
  type LirrPlanResponse,
  type AirspaceResponse,
  type MetarsResponse,
  type TafsResponse,
  TrainsResponseSchema,
  RoutesGeoJSONSchema,
  StopsGeoJSONSchema,
  PlanResponseSchema,
  LirrPlanResponseSchema,
  AirspaceResponseSchema,
  MetarsResponseSchema,
  TafsResponseSchema,
} from "@panoptrain/shared";
import type { z } from "zod";

/**
 * Wall-clock ceiling on any single API request (#133).
 *
 * Without one, a hung connection never settles. That is worse than a slow
 * request: pollers using `inFlightGuard` keep their in-flight flag set
 * forever, so the endpoint silently stops updating for the rest of the
 * session with no error and no recovery.
 *
 * 20s is deliberately generous — the large GeoJSON payloads are multi-MB on
 * a cold cache — while still being far below "never".
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Fetches and parses a JSON API response against a Zod schema (#86).
 * The schema is required: every server response shape we consume lives
 * in `@panoptrain/shared/schemas` and is the source of truth for what
 * the client expects. A schema mismatch surfaces as a typed error
 * rather than silently propagating bad data through the UI.
 *
 * HTTP errors keep their legacy `API <status>: <body>` shape so the
 * existing 503 cold-start detection in `bulkPolling.ts` keeps working.
 */
export async function fetchJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { signal?: AbortSignal },
): Promise<T> {
  // Compose the caller's cancellation (mode switch, unmount) with the
  // timeout so either can end the request.
  //
  // NOTE: `init.signal` must be per-request, not long-lived. AbortSignal.any
  // registers the composite on the source signal's dependant set and it is
  // not pruned when the composite settles — the same retention that caused
  // the server-side poller leak (#128). Every caller here creates a fresh
  // AbortController per fetch, which keeps that bounded.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  const json = await res.json();
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new Error(`Schema mismatch for ${path}: ${result.error.message}`);
  }
  return result.data;
}

export function fetchTrains(mode: Mode, routes?: string[]): Promise<TrainsResponse> {
  const params = routes?.length ? `?routes=${routes.join(",")}` : "";
  return fetchJson(`/${mode}/trains${params}`, TrainsResponseSchema);
}

/** Multi-MB payloads — accept a signal so a mode switch can abort the
 *  download rather than only ignoring its result (#133). */
export function fetchRoutes(mode: Mode, signal?: AbortSignal): Promise<RoutesGeoJSON> {
  return fetchJson(`/${mode}/routes`, RoutesGeoJSONSchema, { signal });
}

export function fetchStops(mode: Mode, signal?: AbortSignal): Promise<StopsGeoJSON> {
  return fetchJson(`/${mode}/stops`, StopsGeoJSONSchema, { signal });
}

/** Subway trip planner — uses an adjacency graph and surfaces minute durations
 *  (subway service is frequent enough that absolute times aren't useful). */
export function fetchPlan(fromIds: string[], toIds: string[]): Promise<PlanResponse> {
  const from = encodeURIComponent(fromIds.join(","));
  const to = encodeURIComponent(toIds.join(","));
  return fetchJson(`/plan?from=${from}&to=${to}`, PlanResponseSchema);
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
  return fetchJson(`/plan/lirr?from=${from}&to=${to}${atParam}`, LirrPlanResponseSchema);
}

/** Live aircraft within ~40 nm of NYC. Server polls adsb.lol on its own
 *  cadence; the client just consumes the latest snapshot. */
export function fetchAirspaceAircraft(): Promise<AirspaceResponse> {
  return fetchJson("/airspace/aircraft", AirspaceResponseSchema);
}

/** Current METAR observations for every NYC-metro airport. Bulk endpoint
 *  — small payload (~5KB for 11 airports) and the popup looks up by ICAO. */
export function fetchMetars(): Promise<MetarsResponse> {
  return fetchJson("/airspace/metar", MetarsResponseSchema);
}

/** Current TAF forecasts for every NYC-metro airport. Bulk endpoint —
 *  payload is ~25KB (forecast periods are richer than METAR observations). */
export function fetchTafs(): Promise<TafsResponse> {
  return fetchJson("/airspace/taf", TafsResponseSchema);
}
