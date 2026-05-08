import type { Aircraft } from "@panoptrain/shared";

/**
 * Display helpers for aircraft popup + label rendering. Pure functions so
 * the formatting logic is unit-testable without mounting React.
 */

/** What to show as the aircraft's primary identifier. Callsigns trump hex
 *  because they're meaningful to viewers ("JBU123" → JetBlue 123); hex is
 *  the airframe ID (ICAO 24-bit) only useful when no callsign is broadcast. */
export function displayCallsign(a: Pick<Aircraft, "callsign" | "hex">): string {
  return a.callsign?.trim() || a.hex.toUpperCase();
}

/** Pressure altitude in feet, comma-grouped. Null is "—" rather than "0 ft"
 *  so users can distinguish "not reporting" from a true ground reading. */
export function formatAltitude(altBaroFt: number | null): string {
  if (altBaroFt === null) return "—";
  if (altBaroFt <= 0) return "Ground";
  return `${altBaroFt.toLocaleString("en-US")} ft`;
}

/** Ground speed in knots — leave the unit explicit so non-aviation viewers
 *  don't conflate it with mph. */
export function formatGroundSpeed(gsKt: number | null): string {
  if (gsKt === null) return "—";
  return `${Math.round(gsKt)} kt`;
}

/** True track expressed as 3-digit degrees + cardinal hint. Showing both
 *  ("090° E") trades a few characters of width for readability — most
 *  users don't read 270 instantly as "westbound". */
export function formatTrack(trackDeg: number | null): string {
  if (trackDeg === null) return "—";
  const deg = Math.round(((trackDeg % 360) + 360) % 360);
  const cardinal = cardinalFor(deg);
  return `${String(deg).padStart(3, "0")}° ${cardinal}`;
}

function cardinalFor(deg: number): string {
  if (deg < 22.5 || deg >= 337.5) return "N";
  if (deg < 67.5) return "NE";
  if (deg < 112.5) return "E";
  if (deg < 157.5) return "SE";
  if (deg < 202.5) return "S";
  if (deg < 247.5) return "SW";
  if (deg < 292.5) return "W";
  return "NW";
}

/** Coarse aircraft kind from ADS-B emitter category. Lets the map style
 *  helicopters differently from jets without a full lookup table. */
export type AircraftKind = "helicopter" | "fixed-wing" | "unknown";

export function aircraftKind(category: string | null): AircraftKind {
  if (!category) return "unknown";
  // ADS-B "A7" is rotorcraft. "B2"-"B6" are surface vehicles / obstacles
  // we'd never want to render as airborne icons even if the feed surfaced
  // them — but the server only requests airborne categories so this is
  // mainly defensive.
  if (category === "A7") return "helicopter";
  if (/^A[1-6]$/.test(category)) return "fixed-wing";
  return "unknown";
}
