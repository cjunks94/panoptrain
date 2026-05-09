import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RoutesGeoJSON } from "@panoptrain/shared";
import {
  _resetTrackCachesForTests,
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
// the prewarm runs synchronously inside this test. Cache reset is needed
// now that buildShapeIndex no longer clears snap/bestShape caches itself
// (globally-unique shape IDs make per-build clears unnecessary in prod
// but tests need explicit isolation).
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("setTimeout", ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
  _resetTrackCachesForTests();
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

  it("cancels a pending prewarm when buildShapeIndex runs again before idle fires", () => {
    // Defer setTimeout instead of running synchronously so we can simulate a
    // rebuild while the first prewarm is still pending. Without the in-module
    // cancellation, the first callback would run after the second
    // buildShapeIndex's clear and poison snapCache with shapeId-0 distances
    // from the stale index.
    const queued: Array<{ id: number; fn: () => void }> = [];
    let nextId = 1;
    const cleared: number[] = [];
    vi.stubGlobal("setTimeout", ((fn: () => void) => {
      const id = nextId++;
      queued.push({ id, fn });
      return id;
    }) as unknown as typeof setTimeout);
    vi.stubGlobal("clearTimeout", ((id: number) => { cleared.push(id); }) as unknown as typeof clearTimeout);

    const coords1: [number, number][] = Array.from({ length: 30 }, (_, i) => [-74 + i * 0.001, 40.7]);
    buildShapeIndex(makeRoutes([{ routeId: "A", coords: coords1 }]));
    expect(queued).toHaveLength(1);

    // Mode flip / second load before the first idle fires.
    const coords2: [number, number][] = Array.from({ length: 30 }, (_, i) => [-73 + i * 0.001, 40.8]);
    buildShapeIndex(makeRoutes([{ routeId: "B", coords: coords2 }]));

    // The first scheduled handle (id=1) must have been cancelled. The second
    // is still pending at id=2.
    expect(cleared).toContain(1);
    expect(queued).toHaveLength(2);

    // Fire what's still actually queued — clearTimeout in real browsers
    // removes the callback from the queue, so the test simulator skips
    // cancelled IDs to mirror that.
    for (const { id, fn } of queued) {
      if (cleared.includes(id)) continue;
      fn();
    }
    // Coords1 (~lat 40.7, lon -74) and coords2 (~lat 40.8, lon -73) live in
    // disjoint grid cells, so without cancellation we'd see entries from both
    // prewarms (12 keys). With cancellation, only coords2's 6 samples (every
    // 5th of 30 coords) survive.
    expect(getTrackCacheSizes().snap).toBe(6);
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
