import type { FlightCategory, MetarReport, MetarsResponse } from "@panoptrain/shared";
import { AIRPORTS } from "@panoptrain/shared";
import { z } from "zod";
import { consoleLogger } from "../lib/logger.js";
import { createSnapshotPoller, fetchWithRetry, type SnapshotPoller } from "./base-poller.js";

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
 */
const AVIATIONWEATHER_BASE = "https://aviationweather.gov/api/data/metar";
const USER_AGENT = "panoptrain/0.1.0 (contact: cjunks94@gmail.com)";
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [0, 1_000, 3_000];
/** Two hours — METARs are valid for ~1h, plus headroom so a transient
 *  upstream outage doesn't blank the popup mid-flight. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const ALL_ICAO = AIRPORTS.map((a) => a.icao);

/** Raw record shape from aviationweather.gov's /api/data/metar endpoint
 *  with format=json. We declare only the fields we read.
 *  Zod-validated at the fetch boundary (#86) so a schema drift surfaces
 *  as a structured log line + cache fallback. */
const AwxMetarCloudSchema = z.object({
  cover: z.string().optional(),
  base: z.number().optional(),
});

const AwxMetarRecordSchema = z.object({
  icaoId: z.string().optional(),
  obsTime: z.number().optional(),
  rawOb: z.string().optional(),
  fltCat: z.string().optional(),
  /** Wind direction, true degrees 0-360. Some records ship "VRB" as a
   *  string for variable wind; we treat that as null. */
  wdir: z.union([z.number(), z.string()]).optional(),
  wspd: z.number().optional(),
  wgst: z.number().optional(),
  /** Statute miles. Sometimes a literal string like "10+" or "1/2"
   *  for unlimited / fractional values. */
  visib: z.union([z.number(), z.string()]).optional(),
  temp: z.number().optional(),
  dewp: z.number().optional(),
  /** hPa (millibars). We convert to inHg at the boundary because that's
   *  the US flight-ops convention. */
  altim: z.number().optional(),
  clouds: z.array(AwxMetarCloudSchema).optional(),
});

const AwxMetarResponseSchema = z.array(AwxMetarRecordSchema);

type AwxMetarRecord = z.infer<typeof AwxMetarRecordSchema>;

const HPA_TO_INHG = 0.02953;

function parseVisibility(visib: AwxMetarRecord["visib"]): number | null {
  if (visib === undefined || visib === null) return null;
  if (typeof visib === "number") return visib;
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

export async function fetchMetarSnapshot(signal?: AbortSignal): Promise<MetarsResponse> {
  const url = `${AVIATIONWEATHER_BASE}?ids=${ALL_ICAO.join(",")}&format=json`;
  const records = await fetchWithRetry<AwxMetarRecord[]>({
    url,
    parse: async (r) => AwxMetarResponseSchema.parse(await r.json()),
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    signal,
  });
  return parseMetarResponse(records);
}

const poller: SnapshotPoller<MetarsResponse> = createSnapshotPoller<MetarsResponse>({
  name: "metar",
  fetchSnapshot: (signal) => fetchMetarSnapshot(signal),
  cacheTtlMs: CACHE_TTL_MS,
  logger: consoleLogger,
  toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
  formatStats: (s) => `${Object.keys(s.reports).length} reports`,
});

export function startMetarPolling(intervalMs: number): void {
  consoleLogger.info("starting poller", { poller: "metar", intervalMs });
  poller.start(intervalMs);
}

export function stopMetarPolling(): void {
  poller.stop();
}

export function getCurrentMetarSnapshot(): MetarsResponse | null {
  return poller.getCurrent();
}

/** Test-only — production code never calls this. */
export const __TEST_INTERNALS__ = poller.__TEST_INTERNALS__;
