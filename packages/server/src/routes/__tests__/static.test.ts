import { describe, it, expect } from "vitest";
import { stationImportance } from "../static.js";

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
