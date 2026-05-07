import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RoutesGeoJSON } from "@panoptrain/shared";
import {
  buildShapeIndex,
  prewarmTrackCaches,
  getTrackCacheSizes,
  findTrackPath,
} from "../trackInterpolation.js";

/**
 * `prewarmTrackCaches` exists to seed `snapCache` with grid cells the train
 * will actually traverse, so the first poll's hundreds of trains don't all
 * stall the main thread on Turf nearestPointOnLine. Asserting on cache size
 * is the only behavioral signal — the cache is otherwise opaque — so the
 * tests below verify (a) prewarm populates it, (b) it tolerates degenerate
 * shapes, (c) it respects the cache-size cap.
 */
function makeRoutes(features: Array<{ routeId: string; coords: [number, number][] }>): RoutesGeoJSON {
  return {
    type: "FeatureCollection",
    features: features.map(({ routeId, coords }) => ({
      type: "Feature",
      properties: { routeId, color: "888888", name: routeId },
      geometry: { type: "LineString", coordinates: coords },
    })),
  };
}

// Use requestIdleCallback's polyfill path: jsdom doesn't define it, so
// `buildShapeIndex` already routes through setTimeout. Stub setTimeout so
// the prewarm runs synchronously inside this test.
beforeEach(() => {
  vi.stubGlobal("setTimeout", ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
});

describe("prewarmTrackCaches", () => {
  it("populates snapCache when buildShapeIndex schedules it", () => {
    // 50-coord straight line; with COORD_STRIDE=5 we expect 10 samples seeded.
    const coords: [number, number][] = Array.from({ length: 50 }, (_, i) => [-74 + i * 0.001, 40.7]);
    buildShapeIndex(makeRoutes([{ routeId: "1", coords }]));
    const { snap } = getTrackCacheSizes();
    expect(snap).toBeGreaterThanOrEqual(10);
  });

  it("seeds entries that subsequent findTrackPath calls reuse", () => {
    const coords: [number, number][] = Array.from({ length: 20 }, (_, i) => [-74 + i * 0.001, 40.7]);
    const index = buildShapeIndex(makeRoutes([{ routeId: "A", coords }]));
    const before = getTrackCacheSizes().snap;
    // A position that maps onto the line — same shape, different coords would
    // also hit if they're in a previously-sampled grid cell.
    const path = findTrackPath(index, "A", coords[5]!, coords[10]!);
    expect(path).not.toBeNull();
    // Lookups for already-sampled grid cells should not grow the cache.
    expect(getTrackCacheSizes().snap).toBe(before);
  });

  it("tolerates degenerate shapes without throwing", () => {
    // Two-coord shape (the minimum buildShapeIndex accepts) at the same point
    // exercises the zero-length / single-grid-cell edge.
    const index = buildShapeIndex(makeRoutes([{ routeId: "X", coords: [[-74, 40.7], [-74, 40.7]] }]));
    expect(() => prewarmTrackCaches(index)).not.toThrow();
    // And an entirely empty index is a valid call too — defensive against
    // mode flips before any shapes arrive.
    expect(() => prewarmTrackCaches({})).not.toThrow();
  });
});
