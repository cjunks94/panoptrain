import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RoutesGeoJSON } from "@panoptrain/shared";
import { buildShapeIndex } from "../trackInterpolation.js";

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
