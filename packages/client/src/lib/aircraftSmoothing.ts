/**
 * Pure math helpers for client-side aircraft dead-reckoning. Kept separate
 * from useAircraftFeatures so the geometry can be unit-tested without
 * mounting React.
 */

const KNOTS_TO_M_S = 0.5144;
const M_PER_DEG_LAT = 111_000;

export interface AircraftSnapshot {
  pos: [number, number];
  /** Heading degrees, 0=N, 90=E. */
  track: number;
  /** Knots. 0 = stationary (parked / surface vehicle). */
  speed: number;
}

/** Advance a snapshot forward in time along its current heading + speed.
 *  Equirectangular approximation — error is sub-meter at NYC-metro
 *  distances over the 8s poll window even for transcontinental jets. */
export function advance(snap: AircraftSnapshot, dtSeconds: number): [number, number] {
  if (snap.speed <= 0 || dtSeconds <= 0) return [snap.pos[0], snap.pos[1]];
  const distM = snap.speed * KNOTS_TO_M_S * dtSeconds;
  const bearingRad = (snap.track * Math.PI) / 180;
  // Track 0=N → +lat, 90=E → +lon. North uses cos, east uses sin (standard
  // navigation convention).
  const dlat = (distM * Math.cos(bearingRad)) / M_PER_DEG_LAT;
  const latRad = (snap.pos[1] * Math.PI) / 180;
  const dlon = (distM * Math.sin(bearingRad)) / (M_PER_DEG_LAT * Math.cos(latRad));
  return [snap.pos[0] + dlon, snap.pos[1] + dlat];
}

export function lerpPos(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
