/**
 * Airspace overlay (live aircraft).
 *
 * Sourced from adsb.lol's community ADS-B feed (ODbL). NYC bbox is fetched
 * server-side; the client consumes the snapshot via /api/airspace/aircraft.
 *
 * Fields are kept narrow for v1 — only what the map layer + popup actually
 * render. Adding more (registration, origin/destination, vertical rate)
 * is a separate change once the visual layer lands.
 */
export interface Aircraft {
  /** ICAO 24-bit hex address — stable per-airframe identifier. Lower-case. */
  hex: string;
  /** Callsign or flight number ("JBU123"). adsb.lol pads with spaces; we trim.
   *  Null when the aircraft isn't broadcasting one. */
  callsign: string | null;
  latitude: number;
  longitude: number;
  /** Pressure altitude in feet. Null when on ground or not reporting. */
  altBaro: number | null;
  /** Ground speed in knots. Null when not reporting. */
  groundSpeed: number | null;
  /** True track in degrees (0=N, 90=E, 180=S, 270=W). Null when stationary. */
  track: number | null;
  /** ADS-B emitter category — coarse type code ("A1"=light, "A3"=medium jet,
   *  "A7"=rotorcraft, etc). Lets the client style helicopters separately
   *  from fixed-wing without lookup tables. Null when not reported. */
  category: string | null;
  /** Mode A squawk code (4-digit octal, e.g., "1234"). 7500/7600/7700 are
   *  the emergency codes worth surfacing in a popup. */
  squawk: string | null;
  /** Epoch ms when this position was last received upstream — i.e.,
   *  `sourceNow - seen*1000`. Lets the client gray out stale aircraft. */
  seenAt: number;
}

export interface AirspaceResponse {
  /** Server time when this snapshot was assembled. */
  timestamp: number;
  /** When the upstream source last reported. May trail `timestamp` by
   *  several seconds during cache-fallback periods. */
  sourceTimestamp: number;
  count: number;
  aircraft: Aircraft[];
  /** "live" if just fetched, "cached" if upstream failed and we're serving
   *  the previous good snapshot. Lets the client surface staleness. */
  source: "live" | "cached";
}
