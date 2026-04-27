import { describe, it, expect } from "vitest";
import { computeFitPadding } from "../mapPadding.js";

/**
 * `computeFitPadding` translates the panel's layout state into MapLibre
 * fitBounds padding so the rendered bbox isn't covered by whichever piece
 * of UI is on screen. Pinning the four quadrants down because regressions
 * are visible only via "the map fits to a sliver" — silent until someone
 * notices on a phone.
 */
describe("computeFitPadding", () => {
  it("pads evenly when the panel is closed (any viewport)", () => {
    expect(computeFitPadding({ isMobile: false, panelOpen: false, viewportHeight: 800 }))
      .toEqual({ top: 60, bottom: 60, left: 60, right: 60 });
    expect(computeFitPadding({ isMobile: true, panelOpen: false, viewportHeight: 800 }))
      .toEqual({ top: 60, bottom: 60, left: 60, right: 60 });
  });

  it("pads 320px on the left for desktop sidebar (panel open)", () => {
    expect(computeFitPadding({ isMobile: false, panelOpen: true, viewportHeight: 1000 }))
      .toEqual({ top: 60, bottom: 60, left: 320, right: 60 });
  });

  it("scales mobile bottom padding with viewport height", () => {
    // iPhone SE: 667 * 0.75 + 30 = 530
    expect(computeFitPadding({ isMobile: true, panelOpen: true, viewportHeight: 667 }))
      .toEqual({ top: 60, bottom: 530, left: 30, right: 30 });
    // iPhone 14: 844 * 0.75 + 30 = 663
    expect(computeFitPadding({ isMobile: true, panelOpen: true, viewportHeight: 844 }))
      .toEqual({ top: 60, bottom: 663, left: 30, right: 30 });
    // iPhone 14 Pro Max: 932 * 0.75 + 30 = 729
    expect(computeFitPadding({ isMobile: true, panelOpen: true, viewportHeight: 932 }))
      .toEqual({ top: 60, bottom: 729, left: 30, right: 30 });
    // Pixel 7: 915 * 0.75 + 30 = 716 (rounded)
    expect(computeFitPadding({ isMobile: true, panelOpen: true, viewportHeight: 915 }))
      .toEqual({ top: 60, bottom: 716, left: 30, right: 30 });
  });

  it("does not apply mobile-specific padding when panel is closed even on mobile", () => {
    // panelOpen short-circuits regardless of viewport
    const mobile = computeFitPadding({ isMobile: true, panelOpen: false, viewportHeight: 932 });
    expect(mobile.bottom).toBe(60);
    expect(mobile.left).toBe(60);
  });
});
