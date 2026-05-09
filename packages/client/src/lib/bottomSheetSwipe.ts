/**
 * Threshold logic for the mobile bottom-sheet swipe-to-dismiss gesture.
 * Pulled out of the component so the math is unit-testable without
 * mounting React or simulating PointerEvents.
 */

/** Past how many pixels of downward drag does a slow drag dismiss the
 *  sheet. Smaller values feel twitchy (taps becoming dismisses);
 *  larger values feel sticky. ~80px is the typical Material/iOS feel. */
const DISMISS_DISTANCE_PX = 80;
/** Smaller distance threshold that still dismisses if the user is
 *  flicking fast — matches "swipe down quickly to close" muscle memory
 *  from iOS Maps / Apple Music. */
const FLICK_DISTANCE_PX = 30;
/** Velocity above which a short drag still counts as a dismiss flick.
 *  In pixels per millisecond — 0.5 px/ms = 500 px/s, roughly the speed
 *  of a relaxed finger flick. */
const FLICK_VELOCITY_PX_PER_MS = 0.5;

export interface SwipeRelease {
  /** Total downward delta in pixels (negative = dragged up; ignored). */
  deltaY: number;
  /** Drag duration in milliseconds (must be > 0). */
  durationMs: number;
}

/** Returns true if the released swipe should dismiss the sheet. */
export function shouldDismissSwipe({ deltaY, durationMs }: SwipeRelease): boolean {
  if (deltaY <= 0) return false; // upward or stationary — never a dismiss
  if (deltaY >= DISMISS_DISTANCE_PX) return true;
  const velocity = deltaY / Math.max(durationMs, 1);
  return deltaY >= FLICK_DISTANCE_PX && velocity >= FLICK_VELOCITY_PX_PER_MS;
}
