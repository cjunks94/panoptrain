import { describe, it, expect } from "vitest";
import { parseMetarResponse } from "../metar-poller.js";

/**
 * Pins the METAR parser shape. The rest of the poller (fetch, cache,
 * retry, polling cadence) is structural and now shared with airspace
 * and taf via base-poller — covered by `base-poller.test.ts`. The
 * value here is the parser handling all the upstream's edge cases
 * cleanly: VRB wind, "10+"/fractional visibility, ceiling derivation,
 * hPa→inHg altimeter conversion.
 */

const NOW = 1_780_000_000_000;

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    icaoId: "KJFK",
    obsTime: 1_779_990_000,
    rawOb: "METAR KJFK ...",
    fltCat: "VFR",
    wdir: 270,
    wspd: 12,
    visib: 10,
    temp: 22,
    dewp: 14,
    altim: 1013,
    clouds: [],
    ...overrides,
  };
}

describe("parseMetarResponse — record-level", () => {
  it("should key reports by ICAO and convert unix-second obsTime to ms", () => {
    const out = parseMetarResponse([makeRecord()], NOW);

    expect(out.reports.KJFK).toBeDefined();
    expect(out.reports.KJFK.observedAt).toBe(1_779_990_000_000);
  });

  it("should drop records missing icaoId", () => {
    const out = parseMetarResponse([makeRecord({ icaoId: undefined }), makeRecord({ icaoId: "KLGA" })], NOW);

    expect(Object.keys(out.reports)).toEqual(["KLGA"]);
  });

  it("should drop records missing obsTime", () => {
    const out = parseMetarResponse([makeRecord({ obsTime: undefined }), makeRecord({ icaoId: "KLGA" })], NOW);

    expect(Object.keys(out.reports)).toEqual(["KLGA"]);
  });

  it("should set sourceTimestamp to the latest observedAt across reports", () => {
    const out = parseMetarResponse([
      makeRecord({ icaoId: "KJFK", obsTime: 1_779_900_000 }),
      makeRecord({ icaoId: "KLGA", obsTime: 1_779_990_000 }),
    ], NOW);

    expect(out.sourceTimestamp).toBe(1_779_990_000_000);
  });

  it("should fall back sourceTimestamp to `now` when no records parsed", () => {
    const out = parseMetarResponse([], NOW);

    expect(out.sourceTimestamp).toBe(NOW);
  });

  it("should mark source as live (createSnapshotPoller flips this to cached on fallback)", () => {
    const out = parseMetarResponse([makeRecord()], NOW);

    expect(out.source).toBe("live");
  });
});

describe("parseMetarResponse — flight category", () => {
  it("should pass through valid FAA categories", () => {
    const out = parseMetarResponse([
      makeRecord({ icaoId: "KJFK", fltCat: "VFR" }),
      makeRecord({ icaoId: "KLGA", fltCat: "MVFR" }),
      makeRecord({ icaoId: "KEWR", fltCat: "IFR" }),
      makeRecord({ icaoId: "KHPN", fltCat: "LIFR" }),
    ], NOW);

    expect(out.reports.KJFK.flightCategory).toBe("VFR");
    expect(out.reports.KLGA.flightCategory).toBe("MVFR");
    expect(out.reports.KEWR.flightCategory).toBe("IFR");
    expect(out.reports.KHPN.flightCategory).toBe("LIFR");
  });

  it("should reject unknown flight category strings as null", () => {
    const out = parseMetarResponse([makeRecord({ fltCat: "WHATEVER" })], NOW);

    expect(out.reports.KJFK.flightCategory).toBeNull();
  });

  it("should default missing fltCat to null", () => {
    const out = parseMetarResponse([makeRecord({ fltCat: undefined })], NOW);

    expect(out.reports.KJFK.flightCategory).toBeNull();
  });
});

describe("parseMetarResponse — wind", () => {
  it("should populate wind block with direction, speed, and gust", () => {
    const out = parseMetarResponse([makeRecord({ wdir: 270, wspd: 12, wgst: 18 })], NOW);

    expect(out.reports.KJFK.wind).toEqual({ directionDeg: 270, speedKt: 12, gustKt: 18 });
  });

  it("should treat VRB direction as null while preserving speed", () => {
    const out = parseMetarResponse([makeRecord({ wdir: "VRB", wspd: 3 })], NOW);

    expect(out.reports.KJFK.wind).toEqual({ directionDeg: null, speedKt: 3, gustKt: null });
  });

  it("should suppress the wind block entirely when calm (wspd=0 and direction missing)", () => {
    const out = parseMetarResponse([makeRecord({ wspd: 0, wdir: undefined })], NOW);

    expect(out.reports.KJFK.wind).toBeNull();
  });
});

describe("parseMetarResponse — visibility", () => {
  it("should pass through numeric visibility unchanged", () => {
    const out = parseMetarResponse([makeRecord({ visib: 5 })], NOW);

    expect(out.reports.KJFK.visibilitySm).toBe(5);
  });

  it("should normalize 10+ string to numeric 10", () => {
    const out = parseMetarResponse([makeRecord({ visib: "10+" })], NOW);

    expect(out.reports.KJFK.visibilitySm).toBe(10);
  });

  it("should parse fractional visibility 1/2 as 0.5", () => {
    const out = parseMetarResponse([makeRecord({ visib: "1/2" })], NOW);

    expect(out.reports.KJFK.visibilitySm).toBe(0.5);
  });

  it("should return null for unparseable visibility strings", () => {
    const out = parseMetarResponse([makeRecord({ visib: "WAT" })], NOW);

    expect(out.reports.KJFK.visibilitySm).toBeNull();
  });
});

describe("parseMetarResponse — ceiling derivation", () => {
  it("should pick lowest BKN base as ceiling, ignoring FEW/SCT layers", () => {
    const out = parseMetarResponse([makeRecord({
      clouds: [
        { cover: "FEW", base: 500 },
        { cover: "SCT", base: 1500 },
        { cover: "BKN", base: 3000 },
        { cover: "OVC", base: 5000 },
      ],
    })], NOW);

    expect(out.reports.KJFK.ceilingFt).toBe(3000);
  });

  it("should pick OVC base when no BKN is present", () => {
    const out = parseMetarResponse([makeRecord({
      clouds: [{ cover: "SCT", base: 1500 }, { cover: "OVC", base: 4000 }],
    })], NOW);

    expect(out.reports.KJFK.ceilingFt).toBe(4000);
  });

  it("should return null ceiling when only FEW/SCT layers are present", () => {
    const out = parseMetarResponse([makeRecord({
      clouds: [{ cover: "FEW", base: 5000 }, { cover: "SCT", base: 8000 }],
    })], NOW);

    expect(out.reports.KJFK.ceilingFt).toBeNull();
  });

  it("should return null ceiling when clouds array is empty", () => {
    const out = parseMetarResponse([makeRecord({ clouds: [] })], NOW);

    expect(out.reports.KJFK.ceilingFt).toBeNull();
  });
});

describe("parseMetarResponse — altimeter conversion", () => {
  it("should convert hPa altim to inHg rounded to 2 decimal places", () => {
    // 1013 hPa * 0.02953 = 29.91... → 29.91
    const out = parseMetarResponse([makeRecord({ altim: 1013 })], NOW);

    expect(out.reports.KJFK.altimeterInHg).toBe(29.91);
  });

  it("should return null altimeter when missing", () => {
    const out = parseMetarResponse([makeRecord({ altim: undefined })], NOW);

    expect(out.reports.KJFK.altimeterInHg).toBeNull();
  });
});
