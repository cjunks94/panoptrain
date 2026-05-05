import { describe, it, expect, vi } from "vitest";
import { enrichWithStatic, interpolatePositions, prewarmInterpolator } from "../position-interpolator.js";
import type { StaticGtfsData } from "../gtfs-loader.js";
import type { ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";

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

/**
 * Pre-build per-gtfs lookups at startup so the first poll's interpolate call
 * doesn't pay for indexing 20k trips inline. The pin: after `prewarmInterpolator`,
 * a subsequent `interpolatePositions` must not log the "Built route->shape lookup"
 * line — that log happens once, when getLookups builds the indexes for a gtfs
 * object it hasn't seen. Pre-fix, that log fires on the first poll; post-fix it
 * fires inside prewarm.
 */
/**
 * `estimateFromTripUpdate` runs for tripUpdates that have no matching vehicle
 * (common during cold-start or feed flakes). Pin: `nextStopId` must be the
 * stop *after* the current target — not a duplicate of currentStopId — so
 * the trip planner's "incoming train" filter behaves correctly. Pre-fix the
 * field was set to `nextStu.stopId` (same as currentStopId).
 */
describe("estimateFromTripUpdate next-stop semantics", () => {
  function makeGtfs(): StaticGtfsData {
    return {
      stops: {
        S1: { stopId: "S1", stopName: "Origin", lat: 40.75, lon: -73.99, parentStation: null },
        S2: { stopId: "S2", stopName: "Mid", lat: 40.76, lon: -73.99, parentStation: null },
        S3: { stopId: "S3", stopName: "End", lat: 40.77, lon: -73.99, parentStation: null },
      },
      routes: {
        "1": { routeId: "1", shortName: "1", longName: "1", color: "000", textColor: "FFF" },
      },
      shapes: {
        "sh-1": {
          shapeId: "sh-1",
          coordinates: [[-73.99, 40.75], [-73.99, 40.76], [-73.99, 40.77]],
        },
      },
      trips: {
        "trip-1": {
          tripId: "trip-1",
          routeId: "1",
          shapeId: "sh-1",
          directionId: 0,
          tripHeadsign: "End",
        },
      },
      stopSequences: {
        "1-0-sh-1": [
          { stopId: "S1", stopSequence: 1 },
          { stopId: "S2", stopSequence: 2 },
          { stopId: "S3", stopSequence: 3 },
        ],
      },
      stopDistances: { "sh-1": { S1: 0, S2: 1.1, S3: 2.2 } },
    };
  }

  function tripUpdate(stops: { stopId: string; arriveAt: number }[]): ParsedTripUpdate {
    return {
      tripId: "trip-1",
      routeId: "1",
      directionId: 0,
      stopTimeUpdates: stops.map((s, i) => ({
        stopId: s.stopId,
        stopSequence: i + 1,
        arrival: { time: s.arriveAt, delay: 0 },
        departure: { time: s.arriveAt + 30, delay: 0 },
      })),
    };
  }

  it("nextStopId points at the stop after the current target while in transit", () => {
    const now = Math.floor(Date.now() / 1000);
    const tu = tripUpdate([
      { stopId: "S1", arriveAt: now - 120 }, // already passed
      { stopId: "S2", arriveAt: now + 60 },  // heading here
      { stopId: "S3", arriveAt: now + 180 }, // after S2
    ]);

    const trains = interpolatePositions([], [tu], makeGtfs());

    expect(trains).toHaveLength(1);
    const t = trains[0];
    expect(t.status).toBe("IN_TRANSIT_TO");
    expect(t.currentStopId).toBe("S2");
    expect(t.nextStopId).toBe("S3");
    expect(t.nextStopName).toBe("End");
  });

  it("nextStopId is null when the train is heading to the final stop", () => {
    const now = Math.floor(Date.now() / 1000);
    const tu = tripUpdate([
      { stopId: "S1", arriveAt: now - 240 },
      { stopId: "S2", arriveAt: now - 120 },
      { stopId: "S3", arriveAt: now + 60 }, // last stop, heading here
    ]);

    const trains = interpolatePositions([], [tu], makeGtfs());

    expect(trains).toHaveLength(1);
    const t = trains[0];
    expect(t.currentStopId).toBe("S3");
    expect(t.nextStopId).toBeNull();
    expect(t.nextStopName).toBeNull();
  });
});

describe("prewarmInterpolator", () => {
  function makeGtfs(): StaticGtfsData {
    return {
      stops: { S1: { stopId: "S1", stopName: "S1", lat: 0, lon: 0, parentStation: null } },
      routes: { "1": { routeId: "1", shortName: "1", longName: "1", color: "000", textColor: "FFF" } },
      shapes: { sh1: { shapeId: "sh1", coordinates: [[0, 0], [0.01, 0]] } },
      trips: { t1: { tripId: "t1", routeId: "1", shapeId: "sh1", directionId: 0, tripHeadsign: "H" } },
      stopSequences: { "1-0-sh1": [{ stopId: "S1", stopSequence: 1 }] },
      stopDistances: { sh1: { S1: 0 } },
    };
  }

  it("populates lookups so subsequent interpolatePositions does not rebuild them", () => {
    const gtfs = makeGtfs();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    prewarmInterpolator(gtfs);
    const buildLogsAfterPrewarm = logSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("Built route->shape lookup"),
    ).length;
    expect(buildLogsAfterPrewarm).toBe(1);

    interpolatePositions([], [], gtfs);
    const buildLogsAfterInterpolate = logSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("Built route->shape lookup"),
    ).length;
    expect(buildLogsAfterInterpolate).toBe(1); // still 1 — interpolate hit the cache

    logSpy.mockRestore();
  });
});
