/**
 * METAR (Meteorological Aerodrome Report) — current weather observation
 * for an airport, issued ~hourly by the FAA. Surfaced in the airport
 * popup so a pilot can scan wind, visibility, ceiling, and category at a
 * glance without leaving the map.
 *
 * Field shapes mirror the parsed structure aviationweather.gov returns,
 * with units normalized for US flight ops (knots, statute miles, feet,
 * inHg). The raw METAR text is preserved verbatim because some pilots
 * want to read the original encoding.
 */

/** Standard FAA flight category buckets, derived from ceiling + visibility:
 *    VFR  — ceiling > 3000 ft AGL AND vis > 5 sm
 *    MVFR — ceiling 1000-3000 OR vis 3-5 sm
 *    IFR  — ceiling 500-1000 OR vis 1-3 sm
 *    LIFR — ceiling < 500 OR vis < 1 sm
 *  Color coding the popup badge by this bucket is the standard
 *  flight-display convention. */
export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface MetarReport {
  /** ICAO code (e.g. "KJFK") — matches AIRPORTS.icao for popup lookup. */
  icao: string;
  /** Observation time, epoch milliseconds. */
  observedAt: number;
  /** Verbatim METAR string. Useful for pilots who want the original. */
  raw: string;
  flightCategory: FlightCategory | null;
  wind: {
    /** True heading in degrees, 0–360. Null = variable / calm. */
    directionDeg: number | null;
    /** Sustained speed in knots. */
    speedKt: number;
    /** Gust speed in knots, null if no gusts reported. */
    gustKt: number | null;
  } | null;
  /** Statute miles. The aviationweather feed sometimes returns "10+" for
   *  unlimited — surface that as a literal 10 with the understanding that
   *  the raw METAR has the precise wording. */
  visibilitySm: number | null;
  /** Lowest broken/overcast layer in feet AGL. Null when sky clear or
   *  only few/scattered. */
  ceilingFt: number | null;
  /** Temperature in Celsius. Some pilots prefer F in summer ops; we
   *  store metric and let the UI decide. */
  tempC: number | null;
  dewpointC: number | null;
  /** Altimeter setting in inHg (US convention). The upstream feed returns
   *  hPa numerically; the server converts to inHg for storage. */
  altimeterInHg: number | null;
}

export interface MetarsResponse {
  /** Server timestamp, epoch ms — when this snapshot was assembled. */
  timestamp: number;
  /** Last successful upstream fetch time, epoch ms. May be older than
   *  `timestamp` if the upstream is currently failing and we're serving
   *  cache. */
  sourceTimestamp: number;
  /** Per-airport reports keyed by ICAO. Missing entry = no current
   *  observation (airport closed, ASOS outage, etc.). */
  reports: Record<string, MetarReport>;
  source: "live" | "cached";
}
