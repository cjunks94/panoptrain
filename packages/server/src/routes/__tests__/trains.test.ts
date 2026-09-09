import { describe, it, expect, beforeEach } from "vitest";
import { updateCache, _resetCacheForTests } from "../../services/cache.js";
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
    lastObservedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

async function fetch(path: string): Promise<TrainsResponse> {
  const res = await trains.request(path);
  return res.json() as Promise<TrainsResponse>;
}

describe("GET /api/trains", () => {
  beforeEach(() => {
    _resetCacheForTests("subway");
    updateCache("subway",[]);
    updateCache("subway",[]);
  });

  it("returns 503 before the poller has produced a snapshot (#143)", async () => {
    // Distinct from "no trains running" (a 200 with an empty array). A
    // poller that never started — GTFS load failed at boot — used to answer
    // 200 + [] forever, indistinguishable from 3am. Matches airspace.ts.
    _resetCacheForTests("subway");
    const res = await trains.request("/");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/snapshot/);
  });

  it("returns an empty array with 200 when a snapshot has no trains", async () => {
    const data = await fetch("/");
    expect(data.trains).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("reports which feeds were served degraded in the current snapshot (#143)", async () => {
    updateCache("subway", [makeTrain({ tripId: "a", routeId: "A" })], ["gtfs-ace"]);
    const data = await fetch("/");
    expect(data.degradedFeeds).toEqual(["gtfs-ace"]);
  });

  it("reports no degraded feeds when every feed was live", async () => {
    updateCache("subway", [makeTrain({ tripId: "a" })]);
    const data = await fetch("/");
    expect(data.degradedFeeds).toEqual([]);
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

  it("includes the previous snapshot when one exists", async () => {
    // Two updateCache calls = the second is current, the first becomes previous.
    updateCache("subway", [makeTrain({ tripId: "old-a" }), makeTrain({ tripId: "old-b" })]);
    updateCache("subway", [makeTrain({ tripId: "new-a" })]);
    const data = await fetch("/");
    expect(data.previous).toBeDefined();
    expect(data.previous!.trains.map((t) => t.tripId).sort()).toEqual(["old-a", "old-b"]);
    expect(data.trains.map((t) => t.tripId)).toEqual(["new-a"]);
  });

  it("applies the same TTL filter to the previous snapshot", async () => {
    const now = Math.floor(Date.now() / 1000);
    updateCache("subway", [
      makeTrain({ tripId: "old-fresh", updatedAt: now - 60 }),
      makeTrain({ tripId: "old-stale", updatedAt: now - 600 }),
    ]);
    updateCache("subway", [makeTrain({ tripId: "new-train", updatedAt: now })]);
    const data = await fetch("/");
    expect(data.previous!.trains.map((t) => t.tripId)).toEqual(["old-fresh"]);
  });

  it("applies the same route filter to the previous snapshot", async () => {
    updateCache("subway", [
      makeTrain({ tripId: "old-1", routeId: "1" }),
      makeTrain({ tripId: "old-A", routeId: "A" }),
    ]);
    updateCache("subway", [
      makeTrain({ tripId: "new-1", routeId: "1" }),
      makeTrain({ tripId: "new-A", routeId: "A" }),
    ]);
    const data = await fetch("/?routes=1");
    expect(data.trains.map((t) => t.tripId)).toEqual(["new-1"]);
    expect(data.previous!.trains.map((t) => t.tripId)).toEqual(["old-1"]);
  });

  it("omits previous when only one snapshot has ever been written", async () => {
    _resetCacheForTests("subway");
    updateCache("subway", [makeTrain({ tripId: "only" })]);
    const data = await fetch("/");
    expect(data.trains.map((t) => t.tripId)).toEqual(["only"]);
    expect(data.previous).toBeUndefined();
  });
});
