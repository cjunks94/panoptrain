import type { FlightCategory, MetarReport, MetarsResponse } from "@panoptrain/shared";
import { AIRPORTS } from "@panoptrain/shared";

/**
 * METAR poller — current-weather observations from aviationweather.gov for
 * each airport in the AIRPORTS list. The popup surfaces wind, visibility,
 * ceiling, temp, altimeter, and the FAA flight category badge so a pilot
 * can scan conditions at a glance.
 *
 * METARs update roughly hourly (the standard observation cycle). Polling
 * faster wastes upstream cycles for no fresher data; we batch all 11
 * airports into one API call every 15 minutes — fast enough to catch
 * special reports (SPECI) without thrashing the upstream.
 *
 * aviationweather.gov etiquette:
 *  - Identify with a useful User-Agent — they monitor for abusive
 *    clients and block them.
 *  - Use the JSON format, not raw text scraping. The JSON endpoint is
 *    explicitly the recommended programmatic interface.
 */
const AVIATIONWEATHER_BASE = "https://aviationweather.gov/api/data/metar";
const USER_AGENT = "panoptrain/0.1.0 (contact: cjunks94@gmail.com)";
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [0, 1_000, 3_000];
/** Two hours — METARs are valid for ~1h, plus headroom so a transient
 *  upstream outage doesn't blank the popup mid-flight. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | undefined;
let snapshot: MetarsResponse | null = null;
let cached: { snapshot: MetarsResponse; cachedAt: number } | null = null;

const ALL_ICAO = AIRPORTS.map((a) => a.icao);

/** Raw record shape from aviationweather.gov's /api/data/metar endpoint
 *  with format=json. We declare only the fields we read; the upstream
 *  ships ~30 fields per record but most of them duplicate the parsed
 *  signal already present elsewhere or relate to upper-air data we
 *  don't surface. */
interface AwxMetarRecord {
  icaoId?: string;
  obsTime?: number;
  rawOb?: string;
  fltCat?: string;
  /** Wind direction, true degrees 0-360. Some records ship "VRB" as a
   *  string for variable wind; we treat that as null. */
  wdir?: number | string;
  /** Knots. Always numeric in the feed. */
  wspd?: number;
  /** Knots. Null/undefined when no gusts reported. */
  wgst?: number;
  /** Statute miles. Sometimes a literal string like "10+" or "1/2"
   *  for unlimited / fractional values. Numeric when straightforward. */
  visib?: number | string;
  /** Celsius. */
  temp?: number;
  dewp?: number;
  /** hPa (millibars). The raw METAR text encodes inHg in "Annnn" form;
   *  the parsed JSON gives us the metric form numerically. We convert
   *  to inHg at the boundary because that's the US flight-ops convention. */
  altim?: number;
  /** Cloud layers, lowest to highest. Used to derive ceiling — the
   *  lowest broken/overcast base. */
  clouds?: Array<{ cover?: string; base?: number }>;
}

const HPA_TO_INHG = 0.02953;

function parseVisibility(visib: AwxMetarRecord["visib"]): number | null {
  if (visib === undefined || visib === null) return null;
  if (typeof visib === "number") return visib;
  // "10+" → 10. "1/2" → 0.5. Otherwise try a numeric parse and bail.
  if (visib === "10+") return 10;
  const slash = visib.indexOf("/");
  if (slash > 0) {
    const num = Number(visib.slice(0, slash));
    const den = Number(visib.slice(slash + 1));
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  }
  const n = Number(visib);
  return Number.isFinite(n) ? n : null;
}

function parseDirection(wdir: AwxMetarRecord["wdir"]): number | null {
  if (wdir === undefined || wdir === null) return null;
  if (typeof wdir === "number") return wdir;
  // "VRB" (variable) and other non-numeric shapes — null is the right
  // signal for "no fixed direction".
  return null;
}

function deriveCeiling(clouds: AwxMetarRecord["clouds"]): number | null {
  if (!clouds || clouds.length === 0) return null;
  // Ceiling = lowest base where cover is broken (BKN), overcast (OVC), or
  // vertical visibility (VV). FEW and SCT layers don't constitute a
  // ceiling for FAA flight-category purposes.
  for (const layer of clouds) {
    const cover = (layer.cover ?? "").toUpperCase();
    if (cover === "BKN" || cover === "OVC" || cover === "VV") {
      return typeof layer.base === "number" ? layer.base : null;
    }
  }
  return null;
}

function isValidFlightCategory(s: string): s is FlightCategory {
  return s === "VFR" || s === "MVFR" || s === "IFR" || s === "LIFR";
}

function parseRecord(rec: AwxMetarRecord): MetarReport | null {
  if (!rec.icaoId || !rec.obsTime) return null;
  const wspd = typeof rec.wspd === "number" ? rec.wspd : 0;
  const wdirParsed = parseDirection(rec.wdir);
  // Suppress the wind block entirely when calm — surfacing "0 kt from
  // null degrees" is noisier than just omitting it.
  const wind = wspd === 0 && wdirParsed === null
    ? null
    : {
        directionDeg: wdirParsed,
        speedKt: wspd,
        gustKt: typeof rec.wgst === "number" ? rec.wgst : null,
      };
  return {
    icao: rec.icaoId,
    observedAt: rec.obsTime * 1000,
    raw: rec.rawOb ?? "",
    flightCategory: rec.fltCat && isValidFlightCategory(rec.fltCat) ? rec.fltCat : null,
    wind,
    visibilitySm: parseVisibility(rec.visib),
    ceilingFt: deriveCeiling(rec.clouds),
    tempC: typeof rec.temp === "number" ? rec.temp : null,
    dewpointC: typeof rec.dewp === "number" ? rec.dewp : null,
    altimeterInHg: typeof rec.altim === "number" ? Math.round(rec.altim * HPA_TO_INHG * 100) / 100 : null,
  };
}

export function parseMetarResponse(records: AwxMetarRecord[], now: number = Date.now()): MetarsResponse {
  const reports: Record<string, MetarReport> = {};
  for (const rec of records) {
    const parsed = parseRecord(rec);
    if (parsed) reports[parsed.icao] = parsed;
  }
  // Source timestamp = the latest observation we have. Beats Date.now()
  // because METARs publish on the hour and the upstream is essentially
  // a passive mirror — its "now" doesn't reflect data freshness.
  let latestObserved = 0;
  for (const r of Object.values(reports)) {
    if (r.observedAt > latestObserved) latestObserved = r.observedAt;
  }
  return {
    timestamp: now,
    sourceTimestamp: latestObserved || now,
    reports,
    source: "live",
  };
}

export async function fetchMetarSnapshot(): Promise<MetarsResponse> {
  const url = `${AVIATIONWEATHER_BASE}?ids=${ALL_ICAO.join(",")}&format=json`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = (await res.json()) as AwxMetarRecord[];
      return parseMetarResponse(records);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function pollOnce(): Promise<void> {
  try {
    const next = await fetchMetarSnapshot();
    snapshot = next;
    cached = { snapshot: next, cachedAt: next.timestamp };
    console.log(`[metar] ok, ${Object.keys(next.reports).length} reports`);
  } catch (err) {
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const ageMin = Math.round((Date.now() - cached.cachedAt) / 60_000);
      console.warn(
        `[metar] fetch failed (${err}); reusing cached snapshot from ${ageMin}m ago`,
      );
      snapshot = { ...cached.snapshot, source: "cached", timestamp: Date.now() };
    } else {
      console.warn(`[metar] fetch failed (${err}); no usable cache`);
      snapshot = null;
    }
  }
}

export function startMetarPolling(intervalMs: number): void {
  stopMetarPolling();
  console.log(`Starting METAR polling every ${intervalMs / 60_000}m...`);
  pollOnce();
  interval = setInterval(pollOnce, intervalMs);
}

export function stopMetarPolling(): void {
  if (interval) clearInterval(interval);
  interval = undefined;
}

export function getCurrentMetarSnapshot(): MetarsResponse | null {
  return snapshot;
}

/** Test-only — production code never calls this. */
export function _resetMetarCache(): void {
  snapshot = null;
  cached = null;
}
