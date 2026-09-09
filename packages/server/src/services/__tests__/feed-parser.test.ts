import { describe, it, expect } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { parseFeed } from "../feed-parser.js";

const { transit_realtime } = GtfsRealtimeBindings;

type FeedInit = Parameters<typeof transit_realtime.FeedMessage.create>[0];

/**
 * Round-trips a FeedMessage through the real protobuf encoder so the parser
 * sees exactly what a wire payload decodes to. That matters here: protobufjs
 * fills unset uint64 fields with a Long-zero *prototype default*, not
 * `undefined`, so a hand-built object with `timestamp: undefined` would not
 * reproduce the bug (#139).
 */
function encode(init: FeedInit): Uint8Array {
  return transit_realtime.FeedMessage.encode(transit_realtime.FeedMessage.create(init)).finish();
}

const HEADER_TS = 1_778_292_406;

describe("parseFeed vehicle timestamp (#139)", () => {
  it("inherits the feed header timestamp when the vehicle carries none", () => {
    const buf = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: HEADER_TS },
      entity: [
        {
          id: "e0",
          // No `timestamp` — decodes to Long{0}, which `??` treats as present.
          vehicle: { trip: { tripId: "t-no-ts", routeId: "1" }, stopId: "S1", currentStatus: 2 },
        },
      ],
    });

    const parsed = parseFeed("subway", buf);

    expect(parsed.vehicles).toHaveLength(1);
    expect(parsed.vehicles[0].timestamp).toBe(HEADER_TS);
  });

  it("keeps the vehicle's own timestamp when it is set", () => {
    const buf = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: HEADER_TS },
      entity: [
        {
          id: "e0",
          vehicle: { trip: { tripId: "t-own-ts", routeId: "1" }, timestamp: HEADER_TS - 17 },
        },
      ],
    });

    const parsed = parseFeed("subway", buf);

    expect(parsed.vehicles[0].timestamp).toBe(HEADER_TS - 17);
  });

  it("falls back to wall-clock seconds when the header itself has no timestamp", () => {
    // Header timestamp is optional in the proto. Reporting 0 here would make
    // every inheriting vehicle look 56 years stale and get TTL-evicted.
    const before = Math.floor(Date.now() / 1000);
    const buf = encode({
      header: { gtfsRealtimeVersion: "2.0" },
      entity: [{ id: "e0", vehicle: { trip: { tripId: "t", routeId: "1" } } }],
    });

    const parsed = parseFeed("subway", buf);
    const after = Math.floor(Date.now() / 1000);

    expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
    expect(parsed.timestamp).toBeLessThanOrEqual(after);
    expect(parsed.vehicles[0].timestamp).toBe(parsed.timestamp);
  });
});

describe("parseFeed stop_time_update times (#139)", () => {
  it("normalizes an unset StopTimeEvent time to null instead of 0", () => {
    // A delay-only event is legal GTFS-RT. Emitting `time: 0` here made the
    // interpolator's `arrival?.time ?? departure?.time` chain pick 0 (not
    // nullish), so the train was treated as having departed in 1970.
    const buf = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: HEADER_TS },
      entity: [
        {
          id: "e0",
          tripUpdate: {
            trip: { tripId: "t", routeId: "1" },
            stopTimeUpdate: [
              { stopId: "S1", stopSequence: 1, arrival: { delay: 45 }, departure: { time: HEADER_TS + 60 } },
            ],
          },
        },
      ],
    });

    const [tu] = parseFeed("subway", buf).tripUpdates;
    const [stu] = tu.stopTimeUpdates;

    expect(stu.arrival).toEqual({ time: null, delay: 45 });
    expect(stu.departure).toEqual({ time: HEADER_TS + 60, delay: 0 });
  });

  it("keeps a missing StopTimeEvent as null and a set time as a number", () => {
    const buf = encode({
      header: { gtfsRealtimeVersion: "2.0", timestamp: HEADER_TS },
      entity: [
        {
          id: "e0",
          tripUpdate: {
            trip: { tripId: "t", routeId: "1" },
            stopTimeUpdate: [{ stopId: "S9", stopSequence: 9, arrival: { time: HEADER_TS + 300, delay: -10 } }],
          },
        },
      ],
    });

    const [stu] = parseFeed("subway", buf).tripUpdates[0].stopTimeUpdates;

    expect(stu.arrival).toEqual({ time: HEADER_TS + 300, delay: -10 });
    expect(stu.departure).toBeNull();
  });
});
