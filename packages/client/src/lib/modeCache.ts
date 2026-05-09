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

// TDD red phase — public surface is in place but every getter returns
// undefined and every setter is a no-op. The tests in
// __tests__/modeCache.test.ts pin the contract; the implementation lands
// in the next commit on this branch.

export function getRoutes(_mode: Mode): RoutesGeoJSON | undefined {
  return undefined;
}

export function setRoutes(_mode: Mode, _data: RoutesGeoJSON): void {
  // no-op
}

export function getStops(_mode: Mode): StopsGeoJSON | undefined {
  return undefined;
}

export function setStops(_mode: Mode, _data: StopsGeoJSON): void {
  // no-op
}

export function getLastTrains(_mode: Mode): CachedTrains | undefined {
  return undefined;
}

export function setLastTrains(_mode: Mode, _data: TrainsResponse): void {
  // no-op
}

export function clearMode(_mode: Mode): void {
  // no-op
}
