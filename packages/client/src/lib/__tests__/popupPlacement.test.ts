import { describe, it, expect } from "vitest";
import { popupOffsetDirection, popupOffsetPx } from "../popupPlacement.js";

/**
 * The popup follows the train but sits perpendicular to its motion so it
 * doesn't end up directly in the path or trail. Pinning the geometry
 * because regressions here are subtle — popup just visually drifts to the
 * "wrong side" without anything obviously broken.
 */
describe("popupOffsetDirection", () => {
  it("places popup north when the train is moving horizontally", () => {
    expect(popupOffsetDirection({ x: -1, y: 0 })).toEqual({ x: 0, y: -1 }); // W → N
    expect(popupOffsetDirection({ x: 1, y: 0 })).toEqual({ x: 0, y: -1 });  // E → N
  });

  it("places popup east when the train is moving vertically", () => {
    // Tie on the y axis (both 0), tiebreaker picks the one with larger x.
    expect(popupOffsetDirection({ x: 0, y: -1 })).toEqual({ x: 1, y: 0 }); // N → E
    expect(popupOffsetDirection({ x: 0, y: 1 })).toEqual({ x: 1, y: 0 });  // S → E
  });

  it("picks the more-northern perpendicular for diagonal motion", () => {
    // NE motion (x positive, y negative). Perpendicular options are NW
    // (-x,-y normalized) and SE (+x,+y normalized). NW has smaller y → wins.
    const ne = popupOffsetDirection({ x: 1, y: -1 });
    expect(ne.y).toBeLessThan(0);                   // pointing north
    expect(ne.x).toBeLessThan(0);                   // pointing west
    expect(Math.hypot(ne.x, ne.y)).toBeCloseTo(1);  // unit vector

    // SW motion → also perpendicular options NW and SE → still NW (same axis).
    const sw = popupOffsetDirection({ x: -1, y: 1 });
    expect(sw).toEqual(ne);
  });

  it("picks the more-northern perpendicular for the other diagonal axis too", () => {
    // NW motion → perpendicular options NE and SW → NE wins (y < 0).
    const nw = popupOffsetDirection({ x: -1, y: -1 });
    expect(nw.y).toBeLessThan(0);
    expect(nw.x).toBeGreaterThan(0);

    const se = popupOffsetDirection({ x: 1, y: 1 });
    expect(se).toEqual(nw);
  });

  it("returns north for a stopped train (zero motion)", () => {
    expect(popupOffsetDirection({ x: 0, y: 0 })).toEqual({ x: 0, y: -1 });
  });

  it("normalizes regardless of input magnitude", () => {
    // Same direction at different speeds should give same offset direction.
    expect(popupOffsetDirection({ x: 100, y: 0 })).toEqual(popupOffsetDirection({ x: 1, y: 0 }));
    expect(popupOffsetDirection({ x: 5, y: -5 })).toEqual(popupOffsetDirection({ x: 1, y: -1 }));
  });
});

describe("popupOffsetPx", () => {
  it("scales the unit direction by the requested pixel distance", () => {
    // W motion → N direction (0, -1). Multiplied by 80px.
    expect(popupOffsetPx({ x: -1, y: 0 }, 80)).toEqual({ x: 0, y: -80 });
  });

  it("preserves the perpendicular geometry at any pixel scale", () => {
    const ne = popupOffsetPx({ x: 1, y: -1 }, 100);
    expect(Math.hypot(ne.x, ne.y)).toBeCloseTo(100);
  });
});
