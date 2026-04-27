import { describe, it, expect, beforeEach } from "vitest";
import { updateCache, getCurrentSnapshot, getPreviousSnapshot } from "../cache.js";
import type { TrainPosition } from "@panoptrain/shared";

function makeTrain(overrides: Partial<TrainPosition> = {}): TrainPosition {
  return {
    tripId: "trip-1",
    routeId: "1",
    direction: 0,
    latitude: 40.75,
    longitude: -73.98,
    bearing: null,
    status: "IN_TRANSIT_TO",
    currentStopId: "101N",
    currentStopName: "Test Station",
    nextStopId: "102N",
    nextStopName: "Next Station",
    destination: "Uptown",
    delay: null,
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("cache", () => {
  beforeEach(() => {
    // Reset cache by pushing two empty snapshots
    updateCache("subway", []);
    updateCache("subway", []);
  });

  it("stores a snapshot and retrieves it", () => {
    const trains = [makeTrain({ tripId: "a" }), makeTrain({ tripId: "b" })];
    updateCache("subway", trains);
    const snapshot = getCurrentSnapshot("subway");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.trains).toHaveLength(2);
    expect(snapshot!.trains[0].tripId).toBe("a");
  });

  it("shifts previous snapshot on update", () => {
    const first = [makeTrain({ tripId: "first" })];
    const second = [makeTrain({ tripId: "second" })];

    updateCache("subway", first);
    updateCache("subway", second);

    expect(getCurrentSnapshot("subway")!.trains[0].tripId).toBe("second");
    expect(getPreviousSnapshot("subway")!.trains[0].tripId).toBe("first");
  });

  it("replaces entire train list each update", () => {
    updateCache("subway", [makeTrain({ tripId: "a" }), makeTrain({ tripId: "b" })]);
    updateCache("subway", [makeTrain({ tripId: "c" })]);

    const snapshot = getCurrentSnapshot("subway")!;
    expect(snapshot.trains).toHaveLength(1);
    expect(snapshot.trains[0].tripId).toBe("c");
  });

  it("includes a timestamp on each snapshot", () => {
    const before = Date.now();
    updateCache("subway", [makeTrain()]);
    const after = Date.now();

    const ts = getCurrentSnapshot("subway")!.timestamp;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("isolates subway and lirr snapshots", () => {
    updateCache("subway", [makeTrain({ tripId: "subway-train" })]);
    updateCache("lirr", [makeTrain({ tripId: "lirr-train", routeId: "Babylon" })]);
    expect(getCurrentSnapshot("subway")!.trains[0].tripId).toBe("subway-train");
    expect(getCurrentSnapshot("lirr")!.trains[0].tripId).toBe("lirr-train");
  });
});
