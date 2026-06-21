import type { Aircraft } from "@panoptrain/shared";
import { consoleLogger } from "../lib/logger.js";
import { createSnapshotPoller, fetchWithRetry, type SnapshotPoller } from "./base-poller.js";

/**
 * Live aircraft poller — community ADS-B via adsb.lol (ODbL, attribution
 * required, no API key, courteous rate limits). Bbox is hardcoded to NYC
 * metro; planes outside that radius aren't worth pulling for the train
 * map use case.
 *
 * adsb.lol etiquette:
 *  - Identify with a useful User-Agent. Anonymous traffic is more likely
 *    to get rate-limited / banned during incidents.
 *  - Don't poll faster than ~1 Hz from a single client. We default to
 *    8s which is generous and reflects how fast aircraft visibly move.
 */
const NYC_LAT = 40.75;
const NYC_LON = -73.97;
const NYC_RADIUS_NM = 40;
const ADSB_LOL_BASE = "https://api.adsb.lol/v2";
const USER_AGENT = "panoptrain/0.1.0 (contact: cjunks94@gmail.com)";
const FETCH_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [0, 500, 1_500];
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface AirspaceSnapshot {
  /** When we assembled this snapshot. */
  timestamp: number;
  /** Upstream's reported `now`. Trails `timestamp` slightly. */
  sourceTimestamp: number;
  aircraft: Aircraft[];
  source: "live" | "cached";
}

/** adsb.lol /v2 response shape — we declare only the fields we read. */
interface AdsbLolResponse {
  ac?: AdsbLolAircraft[] | null;
  /** Upstream's epoch ms at request time. */
  now?: number;
}

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  category?: string;
  squawk?: string;
  /** Seconds since this aircraft was last received upstream. */
  seen?: number;
}

/**
 * Translate the adsb.lol record format to our narrow Aircraft type.
 * Drops anything missing positional data — without lat/lon the marker
 * has nowhere to go and the field is required for any downstream use.
 *
 * Exported for tests so we can pin format expectations without spinning
 * up the full poll loop.
 */
export function parseAdsbLolResponse(payload: AdsbLolResponse, now: number = Date.now()): {
  aircraft: Aircraft[];
  sourceTimestamp: number;
} {
  const sourceTimestamp = typeof payload.now === "number" ? payload.now : now;
  const aircraft: Aircraft[] = [];
  for (const a of payload.ac ?? []) {
    if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if (typeof a.hex !== "string" || a.hex.length === 0) continue;
    // alt_baro can be the literal string "ground" when an aircraft is on
    // the surface — coerce to null rather than NaN so downstream code can
    // distinguish "unknown" from "above ground".
    const altRaw = a.alt_baro;
    const altBaro = typeof altRaw === "number" ? altRaw : null;
    const seenSec = typeof a.seen === "number" ? a.seen : 0;
    aircraft.push({
      hex: a.hex.toLowerCase(),
      callsign: typeof a.flight === "string" && a.flight.trim().length > 0 ? a.flight.trim() : null,
      latitude: a.lat,
      longitude: a.lon,
      altBaro,
      groundSpeed: typeof a.gs === "number" ? a.gs : null,
      track: typeof a.track === "number" ? a.track : null,
      category: typeof a.category === "string" && a.category.length > 0 ? a.category : null,
      squawk: typeof a.squawk === "string" && a.squawk.length > 0 ? a.squawk : null,
      seenAt: sourceTimestamp - Math.round(seenSec * 1000),
    });
  }
  return { aircraft, sourceTimestamp };
}

/** Fetch + parse one snapshot from adsb.lol with retry/timeout. Throws
 *  after exhausting retries; the snapshot poller decides whether to fall
 *  back to cache. Exported for tests. */
export async function fetchAircraftSnapshot(signal?: AbortSignal): Promise<AirspaceSnapshot> {
  const url = `${ADSB_LOL_BASE}/lat/${NYC_LAT}/lon/${NYC_LON}/dist/${NYC_RADIUS_NM}`;
  const payload = await fetchWithRetry<AdsbLolResponse>({
    url,
    parse: async (r) => (await r.json()) as AdsbLolResponse,
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
    timeoutMs: FETCH_TIMEOUT_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    signal,
  });
  const now = Date.now();
  const { aircraft, sourceTimestamp } = parseAdsbLolResponse(payload, now);
  return { timestamp: now, sourceTimestamp, aircraft, source: "live" };
}

const poller: SnapshotPoller<AirspaceSnapshot> = createSnapshotPoller<AirspaceSnapshot>({
  name: "airspace",
  fetchSnapshot: (signal) => fetchAircraftSnapshot(signal),
  cacheTtlMs: CACHE_TTL_MS,
  logger: consoleLogger,
  toCached: (s) => ({ ...s, source: "cached", timestamp: Date.now() }),
  formatStats: (s) => `${s.aircraft.length} aircraft`,
});

export function startAirspacePolling(intervalMs: number): void {
  consoleLogger.info("starting poller", { poller: "airspace", intervalMs });
  poller.start(intervalMs);
}

export function stopAirspacePolling(): void {
  poller.stop();
}

export function getCurrentAirspaceSnapshot(): AirspaceSnapshot | null {
  return poller.getCurrent();
}

/** Test-only — production code never calls this. */
export function _resetAirspaceCache(): void {
  poller.__TEST_INTERNALS__.reset();
}
