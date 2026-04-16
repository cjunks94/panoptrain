import { describe, it, expect, beforeAll } from "vitest";
import { loadStaticGtfs } from "../gtfs-loader.js";
import { buildStationGraph, planTrip, type StationGraph } from "../trip-planner.js";
import type { StaticGtfsData } from "../gtfs-loader.js";

let gtfs: StaticGtfsData;
let graph: StationGraph;

beforeAll(() => {
  gtfs = loadStaticGtfs();
  graph = buildStationGraph(gtfs);
});

describe("trip-planner", () => {
  it("plans a same-line trip without transfers", () => {
    // 127 = Times Sq-42 St, 132 = 14 St (both on the 1/2/3 line)
    const plan = planTrip(graph, gtfs, "127", "132");
    expect(plan).not.toBeNull();
    expect(plan!.transferCount).toBe(0);
    expect(plan!.segments.filter((s) => s.type === "ride")).toHaveLength(1);
    expect(plan!.totalStops).toBeGreaterThan(0);
    expect(plan!.totalMinutes).toBeGreaterThan(0);
  });

  it("plans a trip requiring a transfer at a complex station", () => {
    // 127 (Times Sq) -> L08 (Bedford Av) requires transferring to the L
    const plan = planTrip(graph, gtfs, "127", "L08");
    expect(plan).not.toBeNull();
    expect(plan!.transferCount).toBeGreaterThanOrEqual(1);
    // One of the segments should use the L
    const usesL = plan!.segments.some((s) => s.type === "ride" && s.routeId === "L");
    expect(usesL).toBe(true);
  });

  it("returns null when from == to", () => {
    expect(planTrip(graph, gtfs, "127", "127")).toBeNull();
  });

  it("returns null for unknown stop IDs", () => {
    expect(planTrip(graph, gtfs, "FAKE", "127")).toBeNull();
    expect(planTrip(graph, gtfs, "127", "FAKE")).toBeNull();
  });

  it("populates from/to metadata correctly", () => {
    const plan = planTrip(graph, gtfs, "127", "132");
    expect(plan!.from.stopId).toBe("127");
    expect(plan!.from.stopName).toBe("Times Sq-42 St");
    expect(plan!.to.stopId).toBe("132");
  });
});
