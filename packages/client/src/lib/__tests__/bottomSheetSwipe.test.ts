import { describe, it, expect } from "vitest";
import { shouldDismissSwipe } from "../bottomSheetSwipe.js";

describe("shouldDismissSwipe", () => {
  it("does not dismiss an upward drag", () => {
    expect(shouldDismissSwipe({ deltaY: -50, durationMs: 200 })).toBe(false);
  });

  it("does not dismiss a stationary release (tap)", () => {
    expect(shouldDismissSwipe({ deltaY: 0, durationMs: 100 })).toBe(false);
  });

  it("dismisses a slow long drag past the distance threshold", () => {
    // 100px over 1s — slow but committed downward motion.
    expect(shouldDismissSwipe({ deltaY: 100, durationMs: 1000 })).toBe(true);
  });

  it("does not dismiss a slow short drag (just below threshold)", () => {
    // 60px over 1s — slow and short, neither distance nor velocity
    // crosses thresholds.
    expect(shouldDismissSwipe({ deltaY: 60, durationMs: 1000 })).toBe(false);
  });

  it("dismisses a short fast flick", () => {
    // 50px over 80ms = ~625 px/s — past the flick velocity threshold
    // and past the short-flick distance gate.
    expect(shouldDismissSwipe({ deltaY: 50, durationMs: 80 })).toBe(true);
  });

  it("does not dismiss a flick that's too short in distance", () => {
    // 20px even at high velocity — under FLICK_DISTANCE_PX, treat as
    // an accidental brush rather than an intent to dismiss.
    expect(shouldDismissSwipe({ deltaY: 20, durationMs: 30 })).toBe(false);
  });

  it("guards against a zero duration without crashing", () => {
    // Defensive: the code uses Math.max(durationMs, 1) so the divide
    // by zero is avoided and a 100px drag in 0ms reads as a fast flick.
    expect(shouldDismissSwipe({ deltaY: 100, durationMs: 0 })).toBe(true);
  });
});
