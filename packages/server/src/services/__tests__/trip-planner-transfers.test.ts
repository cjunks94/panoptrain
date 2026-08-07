import { describe, it, expect } from "vitest";
import { buildStationGraph, planTrip } from "../trip-planner.js";
import { loadStaticGtfs, type StaticGtfsData } from "../gtfs-loader.js";

/**
 * Regression coverage for #126 — transfer edges are driven by GTFS
 * transfers.txt, not by matching station names.
 *
 * The old graph connected every pair of parent stations sharing a stopName
 * with no proximity constraint. Because a transfer costs 5 and a stop costs 1,
 * Dijkstra actively *preferred* those edges, so it produced confidently-wrong
 * short plans rather than obviously-broken ones.
 */

const gtfs = loadStaticGtfs("subway");
const graph = buildStationGraph(gtfs);

/** Equirectangular metres — longitude scaled for NYC latitude. */
function metresApart(a: string, b: string): number {
  const sa = gtfs.stops[a];
  const sb = gtfs.stops[b];
  const meanLat = ((sa.lat + sb.lat) / 2) * (Math.PI / 180);
  const dx = (sb.lon - sa.lon) * Math.cos(meanLat);
  const dy = sb.lat - sa.lat;
  return Math.hypot(dx, dy) * 111_320;
}

describe("#126 — transfer edges come from transfers.txt", () => {
  it("should not connect any two platforms more than 600m apart", () => {
    // Longest genuine cross-station transfer in the feed is 435m
    // (Cortlandt St <-> Chambers St). 600m leaves headroom for a schedule
    // change without admitting a teleport.
    const offenders: string[] = [];
    for (const [from, edges] of graph.adjacency) {
      for (const edge of edges) {
        if (edge.type !== "transfer") continue;
        const m = metresApart(from, edge.to);
        if (m > 600) {
          offenders.push(
            `${gtfs.stops[from].stopName} (${from}) <-> ${gtfs.stops[edge.to].stopName} (${edge.to}) = ${Math.round(m)}m`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("should not link 86 St Manhattan to 86 St Brooklyn", () => {
    // The headline case: 21.8km apart, both named "86 St".
    const manhattan = graph.childrenByParent.get("121") ?? [];
    const brooklyn = new Set(graph.childrenByParent.get("N10") ?? []);
    expect(manhattan.length).toBeGreaterThan(0);
    expect(brooklyn.size).toBeGreaterThan(0);

    for (const p of manhattan) {
      const transfers = (graph.adjacency.get(p) ?? []).filter((e) => e.type === "transfer");
      for (const t of transfers) {
        expect(brooklyn.has(t.to), `${p} must not transfer to Bay Ridge 86 St`).toBe(false);
      }
    }
  });

  it("should still connect platforms within a real complex", () => {
    // Times Sq-42 St: platforms across its parents must remain reachable.
    const platforms = graph.childrenByParent.get("127") ?? [];
    expect(platforms.length).toBeGreaterThan(1);
    const linked = platforms.some((p) =>
      (graph.adjacency.get(p) ?? []).some((e) => e.type === "transfer"),
    );
    expect(linked).toBe(true);
  });

  it("should include cross-station transfers the name heuristic could not see", () => {
    // Times Sq <-> 42 St-Port Authority: different names, genuine transfer.
    // Name matching could never produce this edge.
    const timesSq = graph.childrenByParent.get("127") ?? [];
    const portAuth = new Set(graph.childrenByParent.get("A27") ?? []);
    const found = timesSq.some((p) =>
      (graph.adjacency.get(p) ?? []).some((e) => e.type === "transfer" && portAuth.has(e.to)),
    );
    expect(found).toBe(true);
  });
});

describe("#126 — resulting plans are realistic", () => {
  it("should route 96 St Manhattan to Bay Ridge via a real path, not a teleport", () => {
    const plan = planTrip(graph, gtfs, "120", "R45");
    expect(plan).not.toBeNull();
    // Was 4 minutes through a 21.8km "transfer"; the real trip is ~50min.
    expect(plan!.totalMinutes).toBeGreaterThan(30);
  });

  it("should route between the two 86 St stations realistically", () => {
    const plan = planTrip(graph, gtfs, "121", "N10");
    expect(plan).not.toBeNull();
    expect(plan!.totalMinutes).toBeGreaterThan(30);
  });

  it("should keep short trips short", () => {
    // Guards against over-correcting: nearby stops must not gain bogus cost.
    const plan = planTrip(graph, gtfs, "127", "132");
    expect(plan).not.toBeNull();
    expect(plan!.totalMinutes).toBeLessThan(15);
  });

  it("should not emit a leading or trailing transfer segment", () => {
    // Dijkstra's target test fires on any state at a target platform,
    // including one reached via a transfer edge, so paths could begin or end
    // by walking between platforms of the same complex.
    const pairs: [string, string][] = [
      ["120", "R45"],
      ["127", "L08"],
      ["127", "F14"],
      ["631", "R20"],
      ["121", "N10"],
      ["R16", "A32"],
    ];
    for (const [from, to] of pairs) {
      const plan = planTrip(graph, gtfs, from, to);
      if (!plan || plan.segments.length === 0) continue;
      expect(plan.segments[0].type, `${from}->${to} starts with a transfer`).not.toBe("transfer");
      expect(
        plan.segments[plan.segments.length - 1].type,
        `${from}->${to} ends with a transfer`,
      ).not.toBe("transfer");
    }
  });
});

describe("#126 — degrades safely without transfers.txt", () => {
  it("should link only same-parent platforms rather than falling back to name matching", () => {
    // A feed that omits the optional file must lose complex transfers, not
    // regain the teleport bug.
    const stripped: StaticGtfsData = { ...gtfs, transfers: [] };
    const fallback = buildStationGraph(stripped);

    const manhattan = graph.childrenByParent.get("121") ?? [];
    const brooklyn = new Set(graph.childrenByParent.get("N10") ?? []);
    for (const p of manhattan) {
      for (const e of fallback.adjacency.get(p) ?? []) {
        if (e.type === "transfer") expect(brooklyn.has(e.to)).toBe(false);
      }
    }

    // Same-parent platforms are still linked — always true by construction.
    const siblings = fallback.childrenByParent.get("127") ?? [];
    if (siblings.length > 1) {
      const linked = (fallback.adjacency.get(siblings[0]) ?? []).some(
        (e) => e.type === "transfer" && siblings.includes(e.to),
      );
      expect(linked).toBe(true);
    }
  });
});
