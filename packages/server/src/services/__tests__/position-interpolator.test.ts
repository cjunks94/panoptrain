import { describe, it, expect } from "vitest";
import { enrichWithStatic } from "../position-interpolator.js";
import type { StaticGtfsData } from "../gtfs-loader.js";

/**
 * `enrichWithStatic` exists because the LIRR GTFS-RT protobuf leaves
 * `trip.routeId` empty (subway populates it). Without this backfill every
 * LIRR train would have routeId="" and fail shape lookup. These tests pin
 * down the exact behavior since the function silently falls back to the
 * original entry when it can't help.
 */
describe("enrichWithStatic", () => {
  function makeGtfs(): StaticGtfsData {
    return {
      trips: {
        "GO104_26_7770_1": { tripId: "GO104_26_7770_1", routeId: "8", shapeId: "S1", directionId: 1, tripHeadsign: "West Hempstead" },
        "subwayTrip-A1": { tripId: "subwayTrip-A1", routeId: "A", shapeId: "S2", directionId: 0, tripHeadsign: "Far Rockaway" },
      },
      stops: {},
      routes: {},
      shapes: {},
      stopSequences: {},
      stopDistances: {},
    };
  }

  it("fills in routeId from static GTFS when realtime leaves it empty", () => {
    // Mirrors the LIRR case: feed gives us a tripId but no routeId.
    const lirrFromFeed = { tripId: "GO104_26_7770_1", routeId: "", directionId: 0 };
    const enriched = enrichWithStatic(lirrFromFeed, makeGtfs());
    expect(enriched.routeId).toBe("8");
    expect(enriched.directionId).toBe(1); // also picks up direction from static
  });

  it("does not overwrite an already-populated routeId", () => {
    // Subway feed populates routeId — never reach into static GTFS to second-
    // guess it; the realtime value wins.
    const subwayFromFeed = { tripId: "subwayTrip-A1", routeId: "A", directionId: 0 };
    const enriched = enrichWithStatic(subwayFromFeed, makeGtfs());
    expect(enriched).toBe(subwayFromFeed); // exact same reference, no clone
  });

  it("returns the entry unchanged when the tripId is unknown to static GTFS", () => {
    // E.g. a LIRR realtime trip from a newer schedule that the cached static
    // dump doesn't have yet. We can't fix it; just don't crash.
    const orphan = { tripId: "ghost-trip", routeId: "", directionId: 0 };
    const enriched = enrichWithStatic(orphan, makeGtfs());
    expect(enriched).toBe(orphan);
    expect(enriched.routeId).toBe("");
  });
});
