import { describe, it, expect } from "vitest";
import { airportFocusOptions } from "../airportFocus.js";

const baseInput = {
  importance: 1 as const,
  currentZoom: 11,
  isMobile: false,
  panelOpen: true,
  viewportWidth: 1280,
  viewportHeight: 800,
};

describe("airportFocusOptions — zoom", () => {
  it("uses 11.5 for hubs", () => {
    const { zoom } = airportFocusOptions({ ...baseInput, importance: 2, currentZoom: 11 });
    expect(zoom).toBe(11.5);
  });

  it("uses 12 for major secondaries", () => {
    const { zoom } = airportFocusOptions({ ...baseInput, importance: 1, currentZoom: 11 });
    expect(zoom).toBe(12);
  });

  it("uses 12.5 for regional fields", () => {
    const { zoom } = airportFocusOptions({ ...baseInput, importance: 0, currentZoom: 11 });
    expect(zoom).toBe(12.5);
  });

  it("preserves a deeper user-initiated zoom", () => {
    // User has manually zoomed to runway-level detail; the directory
    // click shouldn't yank them back out to the importance default.
    const { zoom } = airportFocusOptions({ ...baseInput, importance: 2, currentZoom: 14 });
    expect(zoom).toBe(14);
  });
});

describe("airportFocusOptions — offset (mobile)", () => {
  it("pushes the pin into the visible map strip when bottom sheet is open", () => {
    // Mobile + panel open: bottom sheet covers ~75vh. The pin must land
    // ABOVE the actual viewport center so it appears inside the
    // top-25vh visible strip. Offset y must be negative.
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: true,
      panelOpen: true,
      viewportHeight: 800,
    });
    expect(offset[0]).toBe(0);
    expect(offset[1]).toBeLessThan(0);
    // Magnitude — visible strip is top 200px, want pin around 160px
    // from top → offset ~= 160 - 400 = -240. Allow small tolerance.
    expect(offset[1]).toBeCloseTo(-240, -1);
  });

  it("pushes the pin into the lower third when the bottom sheet is closed", () => {
    // Panel closed: full viewport visible. Lower third = ~67vh from top.
    // Offset = 67vh - 50vh = +17vh.
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: true,
      panelOpen: false,
      viewportHeight: 800,
    });
    expect(offset[0]).toBe(0);
    expect(offset[1]).toBeGreaterThan(0);
    expect(offset[1]).toBeCloseTo(136, -1); // 800 * 0.17
  });
});

describe("airportFocusOptions — offset (desktop)", () => {
  it("shifts horizontally to clear the 260px sidebar when panel is open", () => {
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: false,
      panelOpen: true,
      viewportWidth: 1280,
    });
    // Centering in the visible strip requires shifting right by half
    // the sidebar width.
    expect(offset[0]).toBe(130);
  });

  it("does not shift horizontally when the panel is closed", () => {
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: false,
      panelOpen: false,
      viewportWidth: 1280,
    });
    expect(offset[0]).toBe(0);
  });

  it("does not shift horizontally on a degenerate narrow viewport", () => {
    // Viewport narrower than the sidebar itself — defensive guard so
    // the offset doesn't push the airport completely off-screen.
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: false,
      panelOpen: true,
      viewportWidth: 200,
    });
    expect(offset[0]).toBe(0);
  });

  it("uses lower-third vertical offset on desktop", () => {
    const { offset } = airportFocusOptions({
      ...baseInput,
      isMobile: false,
      panelOpen: true,
      viewportHeight: 800,
    });
    expect(offset[1]).toBeCloseTo(136, -1);
  });
});
