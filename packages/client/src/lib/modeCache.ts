import type {
  Mode,
  RoutesGeoJSON,
  StopsGeoJSON,
  TrainsResponse,
} from "@panoptrain/shared";

export interface CachedTrains {
  data: TrainsResponse;
  fetchedAt: number;
}

// Module-level slot per mode. Lives outside React so tab-switch unmounts
// don't lose the cached payload — re-mounting `useRouteShapes` /
// `useTrainPositions` reads from here synchronously and skips the refetch
// on cache hit. Keyed by `Mode` (not routeId) to sidestep the documented
// subway/LIRR routeId collision.
const routesByMode = new Map<Mode, RoutesGeoJSON>();
const stopsByMode = new Map<Mode, StopsGeoJSON>();
const trainsByMode = new Map<Mode, CachedTrains>();

export function getRoutes(mode: Mode): RoutesGeoJSON | undefined {
  return routesByMode.get(mode);
}

export function setRoutes(mode: Mode, data: RoutesGeoJSON): void {
  routesByMode.set(mode, data);
}

export function getStops(mode: Mode): StopsGeoJSON | undefined {
  return stopsByMode.get(mode);
}

export function setStops(mode: Mode, data: StopsGeoJSON): void {
  stopsByMode.set(mode, data);
}

export function getLastTrains(mode: Mode): CachedTrains | undefined {
  return trainsByMode.get(mode);
}

export function setLastTrains(mode: Mode, data: TrainsResponse): void {
  trainsByMode.set(mode, { data, fetchedAt: Date.now() });
}

export function clearMode(mode: Mode): void {
  routesByMode.delete(mode);
  stopsByMode.delete(mode);
  trainsByMode.delete(mode);
}
