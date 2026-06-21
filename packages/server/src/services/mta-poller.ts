import { feedsForMode } from "@panoptrain/shared";
import type { Mode, ParsedFeedData, ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";
import { consoleLogger } from "../lib/logger.js";
import { fetchWithRetry } from "./base-poller.js";
import { parseFeed } from "./feed-parser.js";
import { interpolatePositions } from "./position-interpolator.js";
import { updateCache } from "./cache.js";
import type { StaticGtfsData } from "./gtfs-loader.js";

const intervals: Partial<Record<Mode, ReturnType<typeof setInterval>>> = {};
const aborts: Partial<Record<Mode, AbortController>> = {};

/** Per-(mode, feed) cache of the last successful parse. Used as a fallback
 *  when the next fetch fails or returns suspiciously empty — without this,
 *  a single bad poll wipes all the trains for that feed from the snapshot
 *  for ~30 seconds (PR #4 review item).
 *
 *  Keyed `${mode}:${feedId}`. Stale entries are pruned by the TTL guard
 *  in resolveWithFallback below; we never let the cache serve data older
 *  than CACHE_TTL_MS so users don't see "frozen" trains forever if MTA
 *  takes a feed down for an hour. */
const feedCache = new Map<string, { data: ParsedFeedData; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [0, 500, 1_500]; // 3 attempts total

export function startPolling(mode: Mode, gtfs: StaticGtfsData, intervalMs: number): void {
  stopPolling(mode); // idempotent — replaces any existing interval for this mode
  consoleLogger.info("starting poller", { poller: "mta", mode, intervalMs });

  aborts[mode] = new AbortController();
  void pollFeeds(mode, gtfs);
  intervals[mode] = setInterval(() => void pollFeeds(mode, gtfs), intervalMs);
}

/** Wipe the per-feed parse cache. Test-only — production code never calls
 *  this. Cache is otherwise reset only via TTL eviction inside
 *  resolveWithFallback. */
export function _resetCache(): void {
  feedCache.clear();
}

export function stopPolling(mode?: Mode): void {
  const stopOne = (m: Mode) => {
    const i = intervals[m];
    if (i) clearInterval(i);
    delete intervals[m];
    aborts[m]?.abort(new Error("poller stopped"));
    delete aborts[m];
  };
  if (mode) {
    stopOne(mode);
    return;
  }
  for (const k of Object.keys(intervals) as Mode[]) {
    stopOne(k);
  }
}

/** Fetch + parse one feed, with retry/timeout. Throws after all attempts
 *  exhausted; the caller decides whether to fall back to cache. Exported
 *  for unit tests so we can mock fetch and pin retry behavior without
 *  spinning up the full poll loop. */
export async function fetchOneFeed(feedId: string, url: string, signal?: AbortSignal): Promise<ParsedFeedData> {
  return fetchWithRetry<ParsedFeedData>({
    url,
    parse: async (res) => {
      const buf = new Uint8Array(await res.arrayBuffer());
      return parseFeed(feedId, buf);
    },
    timeoutMs: FETCH_TIMEOUT_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    signal,
  });
}

export interface FeedOutcome {
  feedId: string;
  data: ParsedFeedData;
  source: "live" | "cached";
}

/** Resolve a feed for this poll: live if fetch+parse succeeds, otherwise
 *  fall back to cached parse if it's still within TTL. Returns null only
 *  when both live and cache are unavailable. Exported for tests. */
export async function resolveWithFallback(
  mode: Mode,
  feedId: string,
  url: string,
  startTime: number,
  signal?: AbortSignal,
): Promise<FeedOutcome | null> {
  const cacheKey = `${mode}:${feedId}`;
  try {
    const data = await fetchOneFeed(feedId, url, signal);
    feedCache.set(cacheKey, { data, cachedAt: Date.now() });
    consoleLogger.info("feed ok", {
      poller: "mta",
      mode,
      feedId,
      durationMs: Date.now() - startTime,
      vehicles: data.vehicles.length,
      tripUpdates: data.tripUpdates.length,
    });
    return { feedId, data, source: "live" };
  } catch (err) {
    const cached = feedCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const cacheAgeMs = Date.now() - cached.cachedAt;
      consoleLogger.warn("feed cache fallback", {
        poller: "mta",
        mode,
        feedId,
        err,
        cacheAgeMs,
        vehicles: cached.data.vehicles.length,
      });
      return { feedId, data: cached.data, source: "cached" };
    }
    consoleLogger.warn("feed dropped, no cache", { poller: "mta", mode, feedId, err });
    return null;
  }
}

async function pollFeeds(mode: Mode, gtfs: StaticGtfsData): Promise<void> {
  const startTime = Date.now();
  const feeds = feedsForMode(mode);
  const signal = aborts[mode]?.signal;

  try {
    const outcomes = await Promise.all(
      feeds.map((feed) => resolveWithFallback(mode, feed.id, feed.url, startTime, signal)),
    );

    const allVehicles: ParsedVehicle[] = [];
    const allTripUpdates: ParsedTripUpdate[] = [];
    let liveCount = 0;
    let cachedCount = 0;
    let failCount = 0;

    for (const o of outcomes) {
      if (!o) {
        failCount++;
        continue;
      }
      if (o.source === "live") liveCount++;
      else cachedCount++;
      allVehicles.push(...o.data.vehicles);
      allTripUpdates.push(...o.data.tripUpdates);
    }

    const trains = interpolatePositions(allVehicles, allTripUpdates, gtfs);
    updateCache(mode, trains);

    consoleLogger.info("poll ok", {
      poller: "mta",
      mode,
      durationMs: Date.now() - startTime,
      feedsLive: liveCount,
      feedsCached: cachedCount,
      feedsDropped: failCount,
      feedsTotal: feeds.length,
      vehicles: allVehicles.length,
      tripUpdates: allTripUpdates.length,
      positionedTrains: trains.length,
    });
  } catch (err) {
    consoleLogger.error("poll failed", { poller: "mta", mode, err });
  }
}
