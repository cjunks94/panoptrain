import { describe, it, expect } from "vitest";
import { advance, lerpPos } from "../aircraftSmoothing.js";

/**
 * `advance` is the dead-reckoning core for client-side aircraft smoothing.
 * The math is small but easy to flip a sign on (track 0=N, 90=E uses cos
 * for lat and sin for lon, not the other way around), so the cardinal-
 * direction tests below are the regression net.
 */
describe("advance", () => {
  it("should return the input position unchanged when speed is 0", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 90, speed: 0 };
    const out = advance(snap, 10);
    expect(out).toEqual([-73.98, 40.75]);
  });

  it("should return the input position unchanged when dt is 0", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 90, speed: 100 };
    const out = advance(snap, 0);
    expect(out).toEqual([-73.98, 40.75]);
  });

  it("should advance northward when track is 0", () => {
    // 100 kt × 36 s ≈ 1 nautical mile = 1852 m. At 1° lat ≈ 111,000 m, that's
    // ~0.01668° of latitude north of the start point. Longitude unchanged.
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 0, speed: 100 };
    const [lon, lat] = advance(snap, 36);
    expect(lon).toBeCloseTo(-73.98, 6);
    expect(lat).toBeGreaterThan(40.75);
    expect(lat - 40.75).toBeCloseTo(0.01668, 4);
  });

  it("should advance eastward when track is 90", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 90, speed: 100 };
    const [lon, lat] = advance(snap, 36);
    expect(lat).toBeCloseTo(40.75, 6);
    expect(lon).toBeGreaterThan(-73.98);
    // East distance is foreshortened by cos(lat) — at 40.75°, cos ≈ 0.7575,
    // so ~1852 m east is ~0.0220° of longitude rather than ~0.01668°.
    expect(lon - -73.98).toBeCloseTo(0.02201, 3);
  });

  it("should advance southward when track is 180", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 180, speed: 100 };
    const [lon, lat] = advance(snap, 36);
    expect(lon).toBeCloseTo(-73.98, 6);
    expect(lat).toBeLessThan(40.75);
  });

  it("should advance westward when track is 270", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 270, speed: 100 };
    const [lon, lat] = advance(snap, 36);
    expect(lat).toBeCloseTo(40.75, 6);
    expect(lon).toBeLessThan(-73.98);
  });

  it("should scale linearly with dt for the same heading and speed", () => {
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 0, speed: 100 };
    const [, lat10] = advance(snap, 10);
    const [, lat20] = advance(snap, 20);
    const delta10 = lat10 - 40.75;
    const delta20 = lat20 - 40.75;
    expect(delta20 / delta10).toBeCloseTo(2, 4);
  });

  it("should produce displacement consistent with a typical jet over 8s polls", () => {
    // 450 kt × 8 s = ~1850 m. Sanity check the dead-reckoning gap a real
    // commercial jet would cover between adsb.lol polls — should be a small
    // but visible amount on a metro-scale map (~0.01–0.02° in any direction).
    const snap = { pos: [-73.98, 40.75] as [number, number], track: 45, speed: 450 };
    const [lon, lat] = advance(snap, 8);
    const dlat = lat - 40.75;
    const dlon = lon - -73.98;
    const distDegSq = dlat * dlat + dlon * dlon;
    expect(Math.sqrt(distDegSq)).toBeGreaterThan(0.01);
    expect(Math.sqrt(distDegSq)).toBeLessThan(0.03);
  });
});

describe("lerpPos", () => {
  it("should return a when t=0", () => {
    expect(lerpPos([1, 2], [3, 4], 0)).toEqual([1, 2]);
  });

  it("should return b when t=1", () => {
    expect(lerpPos([1, 2], [3, 4], 1)).toEqual([3, 4]);
  });

  it("should return the midpoint when t=0.5", () => {
    expect(lerpPos([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
  });
});
