import type { TafPeriod, TafReport, TafsResponse } from "@panoptrain/shared";
import { AIRPORTS } from "@panoptrain/shared";
import { z } from "zod";
import { consoleLogger } from "../lib/logger.js";
import { createSnapshotPoller, fetchWithRetry, type SnapshotPoller } from "./base-poller.js";

/**
 * TAF poller — terminal aerodrome forecasts from aviationweather.gov
 * for each airport in the AIRPORTS list. The popup surfaces the issue
 * time, validity window, current forecast period, and full raw text.
 *
 * TAFs issue every 6 hours (00, 06, 12, 18 UTC) and are valid for 24-30
 * hours. Amendments fire mid-cycle when conditions deviate from the
 * forecast. Polling every 30 minutes catches amendments within a
 * useful window without thrashing the upstream — TAFs change far less
 * frequently than METARs.
 */
const AVIATIONWEATHER_BASE = "https://aviationweather.gov/api/data/taf";
const USER_AGENT = "panoptrain/0.1.0 (contact: cjunks94@gmail.com)";
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [0, 1_000, 3_000];
/** Eight hours — TAFs are valid 24-30h, but the cache fallback only
 *  needs to bridge a transient upstream outage during the user's active
 *  session. Beyond ~8h the forecast itself starts to feel stale even
 *  if it's still technically within validity. */
const CACHE_TTL_MS = 8 * 60 * 60 * 1000;

const ALL_ICAO = AIRPORTS.map((a) => a.icao);

/** Raw record shape from aviationweather.gov's /api/data/taf endpoint
 *  with format=json. We declare only the fields we read.
 *  Zod-validated at the fetch boundary (#86) so a schema drift surfaces
 *  as a structured log line + cache fallback. */
const AwxTafCloudSchema = z.object({
  cover: z.string().optional(),
  base: z.number().nullable().optional(),
});

const AwxTafForecastSchema = z.object({
  timeFrom: z.number().optional(),
  timeTo: z.number().optional(),
  fcstChange: z.string().nullable().optional(),
  probability: z.number().nullable().optional(),
  wdir: z.union([z.number(), z.string()]).nullable().optional(),
  wspd: z.number().nullable().optional(),
  wgst: z.number().nullable().optional(),
  visib: z.union([z.number(), z.string()]).nullable().optional(),
  wxString: z.string().nullable().optional(),
  clouds: z.array(AwxTafCloudSchema).optional(),
});

const AwxTafRecordSchema = z.object({
  icaoId: z.string().optional(),
  issueTime: z.string().optional(),
  validTimeFrom: z.number().optional(),
  validTimeTo: z.number().optional(),
  rawTAF: z.string().optional(),
  fcsts: z.array(AwxTafForecastSchema).optional(),
});

const AwxTafResponseSchema = z.array(AwxTafRecordSchema);

type AwxTafRecord = z.infer<typeof AwxTafRecordSchema>;
type AwxTafForecast = z.infer<typeof AwxTafForecastSchema>;

function parseVisibility(visib: AwxTafForecast["visib"]): number | null {
  if (visib === undefined || visib === null) return null;
  if (typeof visib === "number") return visib;
  if (visib === "P6SM" || visib === "6+") return 6;
  const slash = visib.indexOf("/");
  if (slash > 0) {
    const num = Number(visib.slice(0, slash));
    const den = Number(visib.slice(slash + 1));
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  }
  const n = Number(visib);
  return Number.isFinite(n) ? n : null;
}

function parseDirection(wdir: AwxTafForecast["wdir"]): number | null {
  if (wdir === undefined || wdir === null) return null;
  if (typeof wdir === "number") return wdir;
  return null;
}

function deriveCeiling(clouds: AwxTafForecast["clouds"]): number | null {
  if (!clouds || clouds.length === 0) return null;
  // Lowest BKN/OVC/VV layer is the ceiling. Scan all qualifying layers
  // rather than returning the first match — the upstream typically
  // sorts by altitude ascending, but the API doesn't document that
  // contract, and an out-of-order layer would otherwise misreport the
  // ceiling in the popup summary.
  let lowest: number | null = null;
  for (const layer of clouds) {
    const cover = (layer.cover ?? "").toUpperCase();
    if ((cover === "BKN" || cover === "OVC" || cover === "VV") && typeof layer.base === "number") {
      if (lowest === null || layer.base < lowest) lowest = layer.base;
    }
  }
  return lowest;
}

const VALID_CHANGES = new Set(["FM", "TEMPO", "BECMG", "PROB"]);

function parseChange(c: AwxTafForecast["fcstChange"]): TafPeriod["fcstChange"] {
  if (!c) return null;
  const upper = c.toUpperCase();
  if (upper.startsWith("PROB")) return "PROB";
  return VALID_CHANGES.has(upper) ? (upper as TafPeriod["fcstChange"]) : null;
}

function parseForecast(f: AwxTafForecast): TafPeriod | null {
  if (typeof f.timeFrom !== "number" || typeof f.timeTo !== "number") return null;
  const wspdParsed = typeof f.wspd === "number" ? f.wspd : null;
  const wdirParsed = parseDirection(f.wdir);
  const wind = wspdParsed === null && wdirParsed === null
    ? null
    : {
        directionDeg: wdirParsed,
        speedKt: wspdParsed,
        gustKt: typeof f.wgst === "number" ? f.wgst : null,
      };
  return {
    timeFrom: f.timeFrom * 1000,
    timeTo: f.timeTo * 1000,
    fcstChange: parseChange(f.fcstChange),
    probability: typeof f.probability === "number" ? f.probability : null,
    wind,
    visibilitySm: parseVisibility(f.visib),
    ceilingFt: deriveCeiling(f.clouds),
    wxString: f.wxString && f.wxString.trim().length > 0 ? f.wxString.trim() : null,
  };
}

function parseRecord(rec: AwxTafRecord): TafReport | null {
  if (!rec.icaoId || !rec.issueTime || typeof rec.validTimeFrom !== "number" ||
      typeof rec.validTimeTo !== "number") {
    return null;
  }
  const issuedAtMs = Date.parse(rec.issueTime);
  if (!Number.isFinite(issuedAtMs)) return null;
  const forecasts: TafPeriod[] = [];
  for (const f of rec.fcsts ?? []) {
    const parsed = parseForecast(f);
    if (parsed) forecasts.push(parsed);
  }
  return {
    icao: rec.icaoId,
    issuedAt: issuedAtMs,
    validFrom: rec.validTimeFrom * 1000,
    validTo: rec.validTimeTo * 1000,
    raw: rec.rawTAF ?? "",
    forecasts,
  };
}

export function parseTafResponse(records: AwxTafRecord[], now: number = Date.now()): TafsResponse {
  const reports: Record<string, TafReport> = {};
  for (const rec of records) {
    const parsed = parseRecord(rec);
    if (parsed) reports[parsed.icao] = parsed;
  }
  let latestIssued = 0;
  for (const r of Object.values(reports)) {
    if (r.issuedAt > latestIssued) latestIssued = r.issuedAt;
  }
  return {
    timestamp: now,
    sourceTimestamp: latestIssued || now,
    reports,
    source: "live",
  };
}

export async function fetchTafSnapshot(signal?: AbortSignal): Promise<TafsResponse> {
  const url = `${AVIATIONWEATHER_BASE}?ids=${ALL_ICAO.join(",")}&format=json`;
  const records = await fetchWithRetry<AwxTafRecord[]>({
    url,
    parse: async (r) => AwxTafResponseSchema.parse(await r.json()),
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    signal,
  });
  return parseTafResponse(records);
}

const poller: SnapshotPoller<TafsResponse> = createSnapshotPoller<TafsResponse>({
  name: "taf",
  fetchSnapshot: (signal) => fetchTafSnapshot(signal),
  cacheTtlMs: CACHE_TTL_MS,
  logger: consoleLogger,
  toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
  formatStats: (s) => `${Object.keys(s.reports).length} reports`,
});

export function startTafPolling(intervalMs: number): void {
  consoleLogger.info("starting poller", { poller: "taf", intervalMs });
  poller.start(intervalMs);
}

export function stopTafPolling(): void {
  poller.stop();
}

export function getCurrentTafSnapshot(): TafsResponse | null {
  return poller.getCurrent();
}

/** Test-only — production code never calls this. */
export const __TEST_INTERNALS__ = poller.__TEST_INTERNALS__;
