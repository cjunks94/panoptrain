import { describe, it, expect } from "vitest";
import type { TafPeriod } from "@panoptrain/shared";
import { findCurrentTafPeriod } from "../tafCurrentPeriod.js";

function p(overrides: Partial<TafPeriod>): TafPeriod {
  return {
    timeFrom: 0,
    timeTo: 0,
    fcstChange: null,
    probability: null,
    wind: null,
    visibilitySm: null,
    ceilingFt: null,
    wxString: null,
    ...overrides,
  };
}

describe("findCurrentTafPeriod", () => {
  const T0 = 1_000;
  const T1 = 2_000;
  const T2 = 3_000;
  const T3 = 4_000;

  it("returns null on an empty forecasts array", () => {
    expect(findCurrentTafPeriod([], T0)).toBeNull();
  });

  it("returns null when there are no base (null/FM) periods — only overlays", () => {
    expect(
      findCurrentTafPeriod(
        [p({ fcstChange: "TEMPO", timeFrom: T0, timeTo: T1 })],
        T0,
      ),
    ).toBeNull();
  });

  it("picks the latest FM whose start is ≤ now, ignoring TEMPO/BECMG overlays", () => {
    const forecasts: TafPeriod[] = [
      p({ fcstChange: null, timeFrom: T0, timeTo: T1, wind: { directionDeg: 100, speedKt: 5, gustKt: null } }),
      p({ fcstChange: "TEMPO", timeFrom: T0, timeTo: T1, visibilitySm: 3 }),
      p({ fcstChange: "FM", timeFrom: T1, timeTo: T2, wind: { directionDeg: 200, speedKt: 10, gustKt: null } }),
      p({ fcstChange: "FM", timeFrom: T2, timeTo: T3, wind: { directionDeg: 300, speedKt: 15, gustKt: null } }),
    ];
    // Now sits inside the second FM window — should pick that, not the
    // earlier base or the TEMPO overlay.
    const result = findCurrentTafPeriod(forecasts, T1 + 500);
    expect(result?.wind?.directionDeg).toBe(200);
  });

  it("falls back to the first base period when `now` precedes the entire TAF", () => {
    const forecasts: TafPeriod[] = [
      p({ fcstChange: null, timeFrom: T1, timeTo: T2, wind: { directionDeg: 100, speedKt: 5, gustKt: null } }),
      p({ fcstChange: "FM", timeFrom: T2, timeTo: T3, wind: { directionDeg: 200, speedKt: 10, gustKt: null } }),
    ];
    const result = findCurrentTafPeriod(forecasts, T0);
    expect(result?.wind?.directionDeg).toBe(100);
  });

  it("stays on the last base period when `now` is past the TAF's validity", () => {
    const forecasts: TafPeriod[] = [
      p({ fcstChange: null, timeFrom: T0, timeTo: T1, wind: { directionDeg: 100, speedKt: 5, gustKt: null } }),
      p({ fcstChange: "FM", timeFrom: T1, timeTo: T2, wind: { directionDeg: 200, speedKt: 10, gustKt: null } }),
    ];
    const result = findCurrentTafPeriod(forecasts, T3 + 1000);
    expect(result?.wind?.directionDeg).toBe(200);
  });
});
