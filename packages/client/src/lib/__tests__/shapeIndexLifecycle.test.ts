import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RoutesGeoJSON } from "@panoptrain/shared";
import {
  __TEST_INTERNALS__,
  buildShapeIndex,
  findTrackPath,
  getTrackCacheSizes,
} from "../trackInterpolation.js";

/**
 * Pins the lifecycle of `buildShapeIndex` w.r.t. mode-tab switching:
 * calling it with the *same* routes object (the cache-hit path on tab
 * re-entry) should be a no-op — return the previously-built index, leave
 * the turf snap caches intact. Calling it with a *different* routes object
 * (fresh fetch landing) must rebuild as today.
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

// jsdom doesn't implement requestIdleCallback, so buildShapeIndex routes
// through setTimeout. Run the prewarm synchronously so cache-size assertions
// reflect the post-prewarm state.
beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("setTimeout", ((fn: () => void) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
  __TEST_INTERNALS__.reset();
});

// Restore real timers so later tests in the same worker don't inherit
// the synchronous setTimeout stub (vitest reuses workers across files).
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildShapeIndex — same routes reference", () => {
  it("returns the same index object on a second call (memoized by ref)", () => {
    const coords: [number, number][] = Array.from({ length: 20 }, (_, i) => [-74 + i * 0.001, 40.7]);
    const routes = makeRoutes([{ routeId: "1", coords }]);
    const first = buildShapeIndex(routes);
    const second = buildShapeIndex(routes);
    expect(second).toBe(first);
  });
});

describe("buildShapeIndex — different routes object", () => {
  it("returns a new index object when given a different routes payload", () => {
    const coords: [number, number][] = Array.from({ length: 20 }, (_, i) => [-74 + i * 0.001, 40.7]);
    const routes1 = makeRoutes([{ routeId: "1", coords }]);
    const routes2 = makeRoutes([{ routeId: "2", coords }]);
    const first = buildShapeIndex(routes1);
    const second = buildShapeIndex(routes2);
    expect(second).not.toBe(first);
  });
});

describe("buildShapeIndex — back-and-forth between two routes payloads", () => {
  // The real subway↔LIRR↔subway tab dance. The first build for each
  // payload is the cold path; subsequent builds for the same payload
  // must return the originally-cached index without rebuilding (so the
  // warmed turf snap caches stay valid).
  it("preserves the original index for each payload across alternating calls", () => {
    const coordsA: [number, number][] = Array.from({ length: 20 }, (_, i) => [-74 + i * 0.001, 40.7]);
    const coordsB: [number, number][] = Array.from({ length: 20 }, (_, i) => [-73 + i * 0.001, 40.8]);
    const routesA = makeRoutes([{ routeId: "A", coords: coordsA }]);
    const routesB = makeRoutes([{ routeId: "B", coords: coordsB }]);

    const a1 = buildShapeIndex(routesA);
    const b1 = buildShapeIndex(routesB);
    const a2 = buildShapeIndex(routesA);
    const b2 = buildShapeIndex(routesB);

    expect(a2).toBe(a1);
    expect(b2).toBe(b1);
    expect(a1).not.toBe(b1);
  });
});

describe("buildShapeIndex — cache lifecycle on rebuild (#138)", () => {
  // Both caches are now keyed by globally-unique shape ids, so neither needs
  // clearing and both stay warm across a mode switch. The previous design
  // cleared bestShapeCache on rebuild because its keys were routeId-based,
  // but that clear sat *below* the memo early-return in buildShapeIndex — so
  // on the subway -> LIRR -> subway path (a memo hit) it never ran, which is
  // exactly the case it existed to protect.
  it("keeps both caches warm across a rebuild", () => {
    const coordsA: [number, number][] = Array.from({ length: 30 }, (_, i) => [-74 + i * 0.001, 40.7]);
    const coordsB: [number, number][] = Array.from({ length: 30 }, (_, i) => [-73 + i * 0.001, 40.8]);
    const routesA = makeRoutes([{ routeId: "A", coords: coordsA }]);
    const routesB = makeRoutes([{ routeId: "B", coords: coordsB }]);

    const indexA = buildShapeIndex(routesA);
    findTrackPath(indexA, "A", coordsA[5]!, coordsA[10]!);
    const after = getTrackCacheSizes();
    expect(after.snap).toBeGreaterThan(0);
    expect(after.bestShape).toBeGreaterThan(0);

    buildShapeIndex(routesB);
    const afterRebuild = getTrackCacheSizes();
    expect(afterRebuild.snap).toBeGreaterThanOrEqual(after.snap);
    // No longer cleared — a warm entry from A cannot answer a B lookup
    // because the key carries A's shape id. See the collision test below.
    expect(afterRebuild.bestShape).toBeGreaterThanOrEqual(after.bestShape);
  });

  // The actual defect #138 describes: subway and LIRR both use numeric
  // routeIds ("1".."9"), so with a routeId-keyed cache a warmed LIRR entry
  // could answer a subway lookup at an overlapping grid cell — Atlantic
  // Terminal and Penn are the realistic overlaps — and route the train along
  // the wrong mode's geometry.
  it("does not let a colliding routeId return the other index's shape", () => {
    // Same routeId "1", same geographic area (so the grid cell matches),
    // but different geometry — as subway and LIRR are at Penn/Atlantic.
    const subwayCoords: [number, number][] = Array.from(
      { length: 30 },
      (_, i) => [-73.99 + i * 0.0005, 40.75] as [number, number],
    );
    const lirrCoords: [number, number][] = Array.from(
      { length: 30 },
      (_, i) => [-73.99 + i * 0.0005, 40.7505] as [number, number],
    );
    const subwayRoutes = makeRoutes([{ routeId: "1", coords: subwayCoords }]);
    const lirrRoutes = makeRoutes([{ routeId: "1", coords: lirrCoords }]);

    const subwayIndex = buildShapeIndex(subwayRoutes);
    const lirrIndex = buildShapeIndex(lirrRoutes);

    // Warm the LIRR entry first, then query subway at the same position.
    const probe = subwayCoords[10]!;
    const lirrPath = findTrackPath(lirrIndex, "1", lirrCoords[5]!, probe);
    const subwayPath = findTrackPath(subwayIndex, "1", subwayCoords[5]!, probe);

    expect(lirrPath).not.toBeNull();
    expect(subwayPath).not.toBeNull();
    // Each must resolve to a shape from its OWN index.
    expect(subwayIndex["1"].some((s) => s.id === subwayPath!.shape.id)).toBe(true);
    expect(lirrIndex["1"].some((s) => s.id === lirrPath!.shape.id)).toBe(true);
    expect(subwayPath!.shape.id).not.toBe(lirrPath!.shape.id);
  });

  // The specific bypass: on the third call the WeakMap hits and returns
  // early, so anything guarding inside buildShapeIndex below that line is
  // skipped. Identity must still be correct after the round trip.
  it("stays correct across subway -> LIRR -> subway, where the memo short-circuits", () => {
    const aCoords: [number, number][] = Array.from(
      { length: 30 },
      (_, i) => [-73.98 + i * 0.0005, 40.76] as [number, number],
    );
    const bCoords: [number, number][] = Array.from(
      { length: 30 },
      (_, i) => [-73.98 + i * 0.0005, 40.7605] as [number, number],
    );
    const a = makeRoutes([{ routeId: "3", coords: aCoords }]);
    const b = makeRoutes([{ routeId: "3", coords: bCoords }]);

    const a1 = buildShapeIndex(a);
    findTrackPath(a1, "3", aCoords[5]!, aCoords[10]!);
    buildShapeIndex(b);
    const a2 = buildShapeIndex(a); // memo hit — the old clear never ran here

    expect(a2).toBe(a1);
    const path = findTrackPath(a2, "3", aCoords[5]!, aCoords[10]!);
    expect(path).not.toBeNull();
    expect(a1["3"].some((s) => s.id === path!.shape.id)).toBe(true);
  });
});
