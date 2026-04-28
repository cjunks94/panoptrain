import { feedsForMode } from "@panoptrain/shared";
import type { Mode, ParsedFeedData, ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";
import { parseFeed } from "./feed-parser.js";
import { interpolatePositions } from "./position-interpolator.js";
import { updateCache } from "./cache.js";
import type { StaticGtfsData } from "./gtfs-loader.js";

const intervals: Partial<Record<Mode, ReturnType<typeof setInterval>>> = {};

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
  console.log(`Starting ${mode} feed polling every ${intervalMs / 1000}s...`);

  pollFeeds(mode, gtfs);
  intervals[mode] = setInterval(() => pollFeeds(mode, gtfs), intervalMs);
}

/** Wipe the per-feed parse cache. Test-only — production code never calls
 *  this. Cache is otherwise reset only via TTL eviction inside
 *  resolveWithFallback. */
export function _resetCache(): void {
  feedCache.clear();
}

export function stopPolling(mode?: Mode): void {
  if (mode) {
    const i = intervals[mode];
    if (i) clearInterval(i);
    delete intervals[mode];
    return;
  }
  // No mode → stop all
  for (const k of Object.keys(intervals) as Mode[]) {
    const i = intervals[k];
    if (i) clearInterval(i);
    delete intervals[k];
  }
}

/** Fetch + parse one feed, with retry/timeout. Throws after all attempts
 *  exhausted; the caller decides whether to fall back to cache. Exported
 *  for unit tests so we can mock fetch and pin retry behavior without
 *  spinning up the full poll loop. */
export async function fetchOneFeed(feedId: string, url: string): Promise<ParsedFeedData> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      return parseFeed(feedId, buf);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
): Promise<FeedOutcome | null> {
  const cacheKey = `${mode}:${feedId}`;
  try {
    const data = await fetchOneFeed(feedId, url);
    feedCache.set(cacheKey, { data, cachedAt: Date.now() });
    console.log(
      `[${mode}/${feedId}] ok in ${Date.now() - startTime}ms, ` +
      `${data.vehicles.length} vehicles, ${data.tripUpdates.length} trip updates`,
    );
    return { feedId, data, source: "live" };
  } catch (err) {
    const cached = feedCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const ageS = Math.round((Date.now() - cached.cachedAt) / 1000);
      console.warn(
        `[${mode}/${feedId}] fetch failed (${err}); reusing cached parse from ${ageS}s ago ` +
        `(${cached.data.vehicles.length} vehicles)`,
      );
      return { feedId, data: cached.data, source: "cached" };
    }
    console.warn(`[${mode}/${feedId}] fetch failed (${err}); no usable cache, dropping`);
    return null;
  }
}

async function pollFeeds(mode: Mode, gtfs: StaticGtfsData): Promise<void> {
  const startTime = Date.now();
  const feeds = feedsForMode(mode);

  try {
    const outcomes = await Promise.all(
      feeds.map((feed) => resolveWithFallback(mode, feed.id, feed.url, startTime)),
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

    const elapsed = Date.now() - startTime;
    const cachedSuffix = cachedCount > 0 ? `, ${cachedCount} cached` : "";
    const failSuffix = failCount > 0 ? `, ${failCount} dropped` : "";
    console.log(
      `Poll ${mode} in ${elapsed}ms: ${liveCount}/${feeds.length} feeds live${cachedSuffix}${failSuffix}, ` +
        `${allVehicles.length} vehicles, ${allTripUpdates.length} trip updates, ` +
        `${trains.length} positioned trains`,
    );
  } catch (err) {
    console.error(`${mode} poll failed:`, err);
  }
}
