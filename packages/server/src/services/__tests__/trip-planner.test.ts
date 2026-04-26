import { describe, it, expect, beforeAll } from "vitest";
import { loadStaticGtfs } from "../gtfs-loader.js";
import { buildStationGraph, planTrip, planTrips, type StationGraph } from "../trip-planner.js";
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

  it("labels the default plan 'Recommended'", () => {
    const plan = planTrip(graph, gtfs, "127", "132");
    expect(plan!.label).toBe("Recommended");
  });

  it("accepts an array of parent IDs and uses any platform as a source", () => {
    // 127, 723, 902, R16 are the four parent stations sharing the name
    // "Times Sq-42 St" in NYC GTFS. Picking the broad set should still find
    // a valid plan to 14 St.
    const candidateNames = ["Times Sq-42 St"];
    const broadFrom = Object.values(gtfs.stops)
      .filter((s) => !s.parentStation && candidateNames.includes(s.stopName))
      .map((s) => s.stopId);
    expect(broadFrom.length).toBeGreaterThan(1);
    const plan = planTrip(graph, gtfs, broadFrom, "132");
    expect(plan).not.toBeNull();
    expect(plan!.totalMinutes).toBeGreaterThan(0);
  });

  it("returns null when from and to overlap", () => {
    expect(planTrip(graph, gtfs, ["127"], ["127", "132"])).toBeNull();
  });

  it("excludes a forbidden route from the result", () => {
    // Times Sq -> 14 St normally rides the 1/2/3. Forbid the 1; planner must
    // pick another route or an alternative path.
    const plan = planTrip(graph, gtfs, "127", "132", {
      excludeRoutes: new Set(["1"]),
    });
    expect(plan).not.toBeNull();
    const usesOne = plan!.segments.some((s) => s.type === "ride" && s.routeId === "1");
    expect(usesOne).toBe(false);
  });
});

describe("planTrips", () => {
  it("returns the primary plan first", () => {
    const plans = planTrips(graph, gtfs, "127", "132", 3);
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans[0].label).toBe("Recommended");
  });

  it("produces alternatives that differ from the primary", () => {
    // Times Sq -> Bedford Av crosses multiple lines; alternatives should exist
    const plans = planTrips(graph, gtfs, "127", "L08", 3);
    expect(plans.length).toBeGreaterThan(1);
    const primaryRoutes = new Set(
      plans[0].segments.filter((s) => s.type === "ride").map((s) => (s as { routeId: string }).routeId),
    );
    // At least one alternative avoids a route the primary used
    const altAvoidsAPrimaryRoute = plans.slice(1).some((alt) => {
      const altRoutes = new Set(
        alt.segments.filter((s) => s.type === "ride").map((s) => (s as { routeId: string }).routeId),
      );
      for (const r of primaryRoutes) if (!altRoutes.has(r)) return true;
      return false;
    });
    expect(altAvoidsAPrimaryRoute).toBe(true);
  });

  it("labels alternatives 'Avoids <route>' or 'Alternative N'", () => {
    const plans = planTrips(graph, gtfs, "127", "L08", 3);
    for (const alt of plans.slice(1)) {
      expect(alt.label).toMatch(/^(Avoids |Alternative )/);
    }
  });

  it("returns empty array when no path exists", () => {
    expect(planTrips(graph, gtfs, "FAKE", "127", 3)).toEqual([]);
  });

  it("falls back to edge-deviation alternatives when route exclusion converges", () => {
    // 127 (Times Sq) -> F14 (Delancey-Essex) is naturally an F-line trip.
    // Route exclusion alone often yields only the primary; edge-deviation
    // should still produce slower distinct alternatives.
    const plans = planTrips(graph, gtfs, "127", "F14", 3);
    expect(plans.length).toBeGreaterThan(1);

    // All alternatives must be structurally distinct from primary
    const primary = plans[0];
    for (const alt of plans.slice(1)) {
      const sameRoutes =
        primary.segments.length === alt.segments.length &&
        primary.segments.every((s, i) => {
          const a = alt.segments[i];
          if (s.type !== a.type) return false;
          if (s.type === "ride" && a.type === "ride") {
            return s.routeId === a.routeId &&
              s.boardAt.stopId === a.boardAt.stopId &&
              s.alightAt.stopId === a.alightAt.stopId;
          }
          return true;
        });
      expect(sameRoutes).toBe(false);
    }
  });
});
