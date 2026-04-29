import { describe, it, expect } from "vitest";
import { enrichWithStatic, interpolatePositions } from "../position-interpolator.js";
import type { StaticGtfsData } from "../gtfs-loader.js";
import type { ParsedVehicle } from "@panoptrain/shared";

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

/**
 * Cross-mode isolation: lookups built from one StaticGtfsData object must not
 * leak into another. Pre-fix, the position-interpolator kept its route/stop/
 * shape lookups in module-level vars and `buildLookups` early-returned once
 * they were populated — so whichever mode polled first won the tables, and
 * subway trains got matched against LIRR shapes (Babylon, Hempstead, …)
 * because LIRR's numeric routeIds collide with subway's. The fix keys
 * lookups by gtfs identity via WeakMap; this test pins that.
 */
describe("interpolatePositions cross-mode isolation", () => {
  function makeMode(label: "lirr" | "subway"): StaticGtfsData {
    // Two stops 1km apart; one shape connects them. Both modes use the same
    // routeId "1" deliberately — that's the collision the bug exploited.
    const headsign = label === "lirr" ? "Babylon" : "Van Cortlandt Park";
    const shapeId = `${label}-shape-1`;
    return {
      stops: {
        STOP1: { stopId: "STOP1", stopName: `${label} stop 1`, lat: 40.75, lon: -73.99, parentStation: null },
        STOP2: { stopId: "STOP2", stopName: `${label} stop 2`, lat: 40.76, lon: -73.99, parentStation: null },
      },
      routes: {
        "1": { routeId: "1", shortName: "1", longName: label, color: "000000", textColor: "FFFFFF" },
      },
      shapes: {
        [shapeId]: {
          shapeId,
          coordinates: [[-73.99, 40.75], [-73.99, 40.76]],
        },
      },
      trips: {
        [`${label}-trip-1`]: {
          tripId: `${label}-trip-1`,
          routeId: "1",
          shapeId,
          directionId: 0,
          tripHeadsign: headsign,
        },
      },
      stopSequences: {
        [`1-0-${shapeId}`]: [
          { stopId: "STOP1", stopSequence: 1 },
          { stopId: "STOP2", stopSequence: 2 },
        ],
      },
      stopDistances: {
        [shapeId]: { STOP1: 0, STOP2: 1.1 },
      },
    };
  }

  function vehicle(routeId: string, stopId: string): ParsedVehicle {
    return {
      tripId: `live-${routeId}-${stopId}`,
      routeId,
      directionId: 0,
      currentStopSequence: 1,
      currentStopId: stopId,
      currentStatus: "STOPPED_AT",
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  it("matches each mode's trains against its own shapes when both have polled", () => {
    const lirr = makeMode("lirr");
    const subway = makeMode("subway");

    // Poll order matters for the bug: LIRR first wins module state pre-fix.
    const lirrTrains = interpolatePositions([vehicle("1", "STOP1")], [], lirr);
    const subwayTrains = interpolatePositions([vehicle("1", "STOP1")], [], subway);

    expect(lirrTrains).toHaveLength(1);
    expect(lirrTrains[0].destination).toBe("Babylon");

    expect(subwayTrains).toHaveLength(1);
    // Pre-fix this would be "Babylon" because subway's "1" reused LIRR's lookup.
    expect(subwayTrains[0].destination).toBe("Van Cortlandt Park");
  });

  it("does not drop trains whose routeId only exists in one mode", () => {
    // Letterd subway routes (A/B/C/...) have no LIRR counterpart. Pre-fix,
    // after LIRR built the lookups, an "A" train's `findBestShape` fell
    // through every pass and the train was silently dropped.
    const lirr = makeMode("lirr");
    const subway: StaticGtfsData = {
      ...makeMode("subway"),
      trips: {
        "subway-A-1": {
          tripId: "subway-A-1",
          routeId: "A",
          shapeId: "subway-A-shape",
          directionId: 0,
          tripHeadsign: "Far Rockaway",
        },
      },
      shapes: {
        "subway-A-shape": { shapeId: "subway-A-shape", coordinates: [[-73.99, 40.75], [-73.99, 40.76]] },
      },
      stopSequences: {
        "A-0-subway-A-shape": [
          { stopId: "STOP1", stopSequence: 1 },
          { stopId: "STOP2", stopSequence: 2 },
        ],
      },
      stopDistances: { "subway-A-shape": { STOP1: 0, STOP2: 1.1 } },
    };

    interpolatePositions([vehicle("1", "STOP1")], [], lirr);
    const subwayTrains = interpolatePositions([vehicle("A", "STOP1")], [], subway);

    expect(subwayTrains).toHaveLength(1);
    expect(subwayTrains[0].routeId).toBe("A");
    expect(subwayTrains[0].destination).toBe("Far Rockaway");
  });
});
