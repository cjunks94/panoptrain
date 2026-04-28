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

/** Extract a user-facing train number from a GTFS tripId. The tripId
 *  formats vary by mode:
 *    LIRR   → "GO104_26_705"           → 705 (rider-visible train number)
 *    Subway → "AFA25...00_006600_..."  → 006600 (trip-start time slot)
 *
 *  We pick the LAST run of 3+ consecutive digits because:
 *    - In LIRR IDs the train number is the trailing segment, and there's
 *      usually a smaller 2-3 digit "schedule version" earlier (e.g. 104)
 *      that we want to ignore.
 *    - In subway IDs the only 3+ digit run is the time slot, and rider-
 *      visible train numbers don't really exist anyway — power users
 *      just want any unique handle.
 *
 *  Returns null when no match is found rather than the raw tripId so
 *  callers can decide whether to render the row at all. */
export function trainNumber(tripId: string): string | null {
  const matches = tripId.match(/\d{3,}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

/** Convert a bearing in degrees (0=N, 90=E, 180=S, 270=W) to one of the
 *  8 compass directions. Snaps to the nearest 45° sector. Returns null
 *  for invalid inputs (null bearing, NaN) so callers can hide the
 *  direction indicator when we don't have heading data — happens for
 *  trains at terminal stops or when the protobuf omits bearing.
 *
 *  Sectors are inclusive on the lower bound: a bearing of exactly 22.5°
 *  rounds to NE, 67.5° rounds to E, etc. */
export type Cardinal = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export function bearingToCardinal(deg: number | null): Cardinal | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  // Normalize negative or >360 inputs into [0, 360).
  const normalized = ((deg % 360) + 360) % 360;
  const sectors: Cardinal[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  // Each sector spans 45°; offset by half a sector so 0° → N (not split
  // between N and NW). Math.floor((deg + 22.5) / 45) % 8 gives the index.
  return sectors[Math.floor((normalized + 22.5) / 45) % 8];
}
