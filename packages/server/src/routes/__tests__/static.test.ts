import { describe, it, expect } from "vitest";
import { stationImportance, pickShapes, type ShapeCandidate } from "../static.js";

/**
 * `stationImportance` drives station-dot sizing and label-filter thresholds
 * on the map. The buckets are calibrated differently per mode (subway by
 * routeCount, LIRR by a curated hub name list). Pinning the rules down
 * because the layer config silently degrades if the buckets shift — every
 * `["==", ["get", "importance"], 2]` check would just stop matching.
 */
describe("stationImportance", () => {
  describe("subway (routeCount thresholds)", () => {
    it("returns 2 for hub stations (>= 8 routes)", () => {
      // Times Sq has ~11 distinct routes via its parent station
      expect(stationImportance("subway", "Times Sq-42 St", 11)).toBe(2);
      expect(stationImportance("subway", "Atlantic Av-Barclays Ctr", 8)).toBe(2);
    });

    it("returns 1 for mid-tier stations (4-7 routes)", () => {
      expect(stationImportance("subway", "14 St-Union Sq", 7)).toBe(1);
      expect(stationImportance("subway", "Generic Interchange", 4)).toBe(1);
    });

    it("returns 0 for local stops (< 4 routes)", () => {
      expect(stationImportance("subway", "Some Local Stop", 3)).toBe(0);
      expect(stationImportance("subway", "Single-line Stop", 1)).toBe(0);
      expect(stationImportance("subway", "Phantom Stop", 0)).toBe(0);
    });
  });

  describe("lirr (curated hub list, ignores routeCount)", () => {
    it("returns 2 for the curated major hubs", () => {
      // Western terminals and Jamaica regardless of how few routes pass through
      expect(stationImportance("lirr", "Penn Station", 1)).toBe(2);
      expect(stationImportance("lirr", "Jamaica", 10)).toBe(2);
      expect(stationImportance("lirr", "Atlantic Terminal", 2)).toBe(2);
      expect(stationImportance("lirr", "Grand Central", 1)).toBe(2);
      expect(stationImportance("lirr", "Long Island City", 1)).toBe(2);
    });

    it("returns 1 for every other LIRR stop, regardless of routeCount", () => {
      // LIRR's geographic spread means every station deserves a label at
      // wider zooms — subway's "local-stop = 0" calibration would hide them.
      expect(stationImportance("lirr", "Babylon", 1)).toBe(1);
      expect(stationImportance("lirr", "Hicksville", 2)).toBe(1);
      expect(stationImportance("lirr", "Hempstead Gardens", 1)).toBe(1);
    });

    it("does not surface 0 for LIRR — every stop gets a label at zoom 12", () => {
      expect(stationImportance("lirr", "Anywhere", 1)).not.toBe(0);
    });
  });
});

/**
 * `pickShapes` decides which shape variants make it onto `/routes`. The
 * subtle requirement: LIRR branches that physically reach Atlantic Terminal
 * or Grand Central must emit a polyline that touches those stops, even when
 * the longest variant for that route+direction terminates at Penn Station.
 * Earlier "longest per route+direction" picker silently dropped Atlantic /
 * GCT track and the user reported floating trains.
 */
describe("pickShapes", () => {
  const shape = (
    shapeId: string,
    routeId: string,
    directionId: number,
    stopSequence: string[],
    coordCount?: number,
  ): ShapeCandidate => ({
    shapeId,
    routeId,
    directionId,
    coordCount: coordCount ?? stopSequence.length * 10,
    stopSequence,
  });

  it("emits the longest shape per (route, direction)", () => {
    const out = pickShapes([
      shape("s1", "1", 0, ["A", "B", "C"], 30),
      shape("s2", "1", 0, ["A", "B"], 20),
    ]);
    expect(out.map((c) => c.shapeId)).toEqual(["s1"]);
  });

  it("adds extra shapes whose endpoint reaches a NEW terminal stop", () => {
    // Babylon Branch–style: longest goes Penn→Babylon, second goes
    // Atlantic→Babylon. Atlantic is not on the longest's stop sequence so
    // the second shape must be emitted.
    const longest = shape("penn-bab", "1", 1, ["PENN", "JAM", "BAB"], 100);
    const atlantic = shape("atl-bab", "1", 1, ["ATL", "JAM", "BAB"], 80);
    const gct = shape("gct-bab", "1", 1, ["GCT", "JAM", "BAB"], 90);
    const out = pickShapes([longest, atlantic, gct]);
    const ids = out.map((c) => c.shapeId).sort();
    expect(ids).toEqual(["atl-bab", "gct-bab", "penn-bab"]);
  });

  it("suppresses short-turn variants whose endpoints sit mid-line on the main shape", () => {
    // Subway–style: A train longest is Inwood→Far Rockaway, short turn
    // ends at Euclid which is mid-line. Euclid's already covered by the
    // main shape so no extra emission.
    const longest = shape("inw-far", "A", 0, ["INW", "59", "EUC", "FAR"], 200);
    const shortTurn = shape("inw-euc", "A", 0, ["INW", "59", "EUC"], 100);
    const out = pickShapes([longest, shortTurn]);
    expect(out.map((c) => c.shapeId)).toEqual(["inw-far"]);
  });

  it("emits a branch terminal even for subway when the longest doesn't reach it", () => {
    // A train: Inwood→Far Rockaway is longest, but Lefferts is a separate
    // terminal not on the Far Rockaway shape. Lefferts variant must emit.
    const longest = shape("inw-far", "A", 0, ["INW", "59", "EUC", "FAR"], 200);
    const lefferts = shape("inw-lef", "A", 0, ["INW", "59", "EUC", "LEF"], 180);
    const out = pickShapes([longest, lefferts]);
    expect(out.map((c) => c.shapeId).sort()).toEqual(["inw-far", "inw-lef"]);
  });

  it("emits a shape whose BOTH endpoints are off the main shape", () => {
    // Pin the both-endpoints-new branch: longest covers PENN→BAB; an
    // entirely separate variant runs ATL→FAR sharing only the mid-line
    // JAM stop. Without handling both-new, the second endpoint (FAR)
    // wouldn't be tracked and a later FAR-terminating variant could be
    // wrongly suppressed.
    const longest = shape("penn-bab", "1", 0, ["PENN", "JAM", "BAB"], 100);
    const bothNew = shape("atl-far", "1", 0, ["ATL", "JAM", "FAR"], 90);
    const out = pickShapes([longest, bothNew]);
    expect(out.map((c) => c.shapeId).sort()).toEqual(["atl-far", "penn-bab"]);
  });

  it("does not double-emit when a later variant repeats both already-covered new endpoints", () => {
    const longest = shape("penn-bab", "1", 0, ["PENN", "JAM", "BAB"], 100);
    const bothNew = shape("atl-far", "1", 0, ["ATL", "JAM", "FAR"], 90);
    const repeats = shape("atl-far-2", "1", 0, ["ATL", "JAM", "FAR"], 80);
    const out = pickShapes([longest, bothNew, repeats]);
    expect(out.map((c) => c.shapeId).sort()).toEqual(["atl-far", "penn-bab"]);
  });

  it("only emits one extra per distinct new terminal even when many variants reach it", () => {
    const longest = shape("a", "1", 0, ["P", "J", "B"], 100);
    const atl1 = shape("b", "1", 0, ["ATL", "J", "B"], 90);
    const atl2 = shape("c", "1", 0, ["ATL", "J", "B"], 80);
    const out = pickShapes([longest, atl1, atl2]);
    expect(out.map((c) => c.shapeId)).toEqual(["a", "b"]);
  });

  it("scopes the comparison per (route, direction) — different directions don't cross-contaminate", () => {
    const out = pickShapes([
      shape("d0", "1", 0, ["A", "B", "C"], 30),
      shape("d1", "1", 1, ["C", "B", "A"], 30),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.shapeId).sort()).toEqual(["d0", "d1"]);
  });

  it("skips degenerate shapes (single coord or single stop)", () => {
    const out = pickShapes([
      shape("good", "1", 0, ["A", "B"], 10),
      shape("one-coord", "1", 0, ["A", "B"], 1),
      shape("one-stop", "1", 0, ["A"], 10),
    ]);
    expect(out.map((c) => c.shapeId)).toEqual(["good"]);
  });
});
