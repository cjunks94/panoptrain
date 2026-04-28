/** Geometry for the train info popup that follows a moving train.
 *  Pure functions — no MapLibre / DOM dependencies, easy to unit test. */

export interface ScreenVec {
  x: number;
  y: number;
}

/** Compute where the popup should sit relative to the train's screen
 *  position. The popup is placed perpendicular to the train's direction of
 *  motion. Of the two perpendicular options, prefer the one with more
 *  northern (smaller `y`, since screen y grows downward) component; on a
 *  tie, prefer the one with more eastern (larger `x`) component.
 *
 *  Examples (motion → popup direction):
 *    W (-1, 0)  → N  (0, -1)    — moving left puts popup on top
 *    E ( 1, 0)  → N  (0, -1)    — moving right also puts popup on top
 *    N ( 0,-1)  → E  ( 1, 0)    — moving up puts popup to the right
 *    S ( 0, 1)  → E  ( 1, 0)    — moving down also puts popup to the right
 *    NE( 1,-1)  → NW (-1,-1)/√2 — perpendicular with more north wins
 *    SW(-1, 1)  → NW (-1,-1)/√2 — same axis as NE, also picks NW (more north)
 *
 *  When the train has no detectable motion (stopped, or projection collapses
 *  on a sharp curve), default to north so the popup never sits exactly on
 *  the train. */
export function popupOffsetDirection(motion: ScreenVec): ScreenVec {
  const len = Math.hypot(motion.x, motion.y);
  if (len < 1e-6) return { x: 0, y: -1 };

  const mx = motion.x / len;
  const my = motion.y / len;

  // Two perpendicular candidates: rotate motion 90° CCW and 90° CW.
  // Screen y grows downward, so the math is the same as standard 2D rotation.
  // `+ 0` collapses -0 → 0 so deep-equal comparisons in tests behave.
  const ccw = { x: -my + 0, y: mx + 0 };
  const cw = { x: my + 0, y: -mx + 0 };

  // Prefer the one with smaller y (more north). Ties break on larger x (more east).
  if (cw.y < ccw.y) return cw;
  if (ccw.y < cw.y) return ccw;
  return cw.x >= ccw.x ? cw : ccw;
}

/** Combine the perpendicular direction with a pixel offset to get the
 *  popup's screen-space delta from the train's position. */
export function popupOffsetPx(motion: ScreenVec, distancePx: number): ScreenVec {
  const dir = popupOffsetDirection(motion);
  return { x: dir.x * distancePx + 0, y: dir.y * distancePx + 0 };
}
