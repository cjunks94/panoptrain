import { describe, it, expect, beforeEach } from "vitest";
import { updateCache } from "../../services/cache.js";
import { createTrainsRouter } from "../trains.js";
import type { TrainPosition, TrainsResponse } from "@panoptrain/shared";

const trains = createTrainsRouter("subway");

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

async function fetch(path: string): Promise<TrainsResponse> {
  const res = await trains.request(path);
  return res.json() as Promise<TrainsResponse>;
}

describe("GET /api/trains", () => {
  beforeEach(() => {
    updateCache("subway",[]);
    updateCache("subway",[]);
  });

  it("returns empty array when no data", async () => {
    const data = await fetch("/");
    expect(data.trains).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("returns all trains from cache", async () => {
    updateCache("subway",[makeTrain({ tripId: "a" }), makeTrain({ tripId: "b" })]);
    const data = await fetch("/");
    expect(data.count).toBe(2);
    expect(data.trains.map((t) => t.tripId)).toEqual(["a", "b"]);
  });

  it("filters by route query param", async () => {
    updateCache("subway",[
      makeTrain({ tripId: "a", routeId: "1" }),
      makeTrain({ tripId: "b", routeId: "A" }),
      makeTrain({ tripId: "c", routeId: "1" }),
    ]);
    const data = await fetch("/?routes=1");
    expect(data.count).toBe(2);
    expect(data.trains.every((t) => t.routeId === "1")).toBe(true);
  });

  it("filters by multiple routes", async () => {
    updateCache("subway",[
      makeTrain({ tripId: "a", routeId: "1" }),
      makeTrain({ tripId: "b", routeId: "A" }),
      makeTrain({ tripId: "c", routeId: "7" }),
    ]);
    const data = await fetch("/?routes=1,A");
    expect(data.count).toBe(2);
    expect(data.trains.map((t) => t.routeId).sort()).toEqual(["1", "A"]);
  });

  it("evicts trains older than TTL (5 minutes)", async () => {
    const now = Math.floor(Date.now() / 1000);
    updateCache("subway",[
      makeTrain({ tripId: "fresh", updatedAt: now - 60 }),   // 1 min old
      makeTrain({ tripId: "stale", updatedAt: now - 600 }),  // 10 min old
    ]);
    const data = await fetch("/");
    expect(data.count).toBe(1);
    expect(data.trains[0].tripId).toBe("fresh");
  });

  it("route filter is case-insensitive", async () => {
    updateCache("subway",[makeTrain({ tripId: "a", routeId: "A" })]);
    const data = await fetch("/?routes=a");
    expect(data.count).toBe(1);
  });
});
