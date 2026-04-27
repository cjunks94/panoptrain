import { feedsForMode } from "@panoptrain/shared";
import type { Mode, ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";
import { parseFeed } from "./feed-parser.js";
import { interpolatePositions } from "./position-interpolator.js";
import { updateCache } from "./cache.js";
import type { StaticGtfsData } from "./gtfs-loader.js";

const intervals: Partial<Record<Mode, ReturnType<typeof setInterval>>> = {};

export function startPolling(mode: Mode, gtfs: StaticGtfsData, intervalMs: number): void {
  stopPolling(mode); // idempotent — replaces any existing interval for this mode
  console.log(`Starting ${mode} feed polling every ${intervalMs / 1000}s...`);

  pollFeeds(mode, gtfs);
  intervals[mode] = setInterval(() => pollFeeds(mode, gtfs), intervalMs);
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

async function pollFeeds(mode: Mode, gtfs: StaticGtfsData): Promise<void> {
  const startTime = Date.now();
  const feeds = feedsForMode(mode);

  try {
    const results = await Promise.allSettled(
      feeds.map(async (feed) => {
        const res = await fetch(feed.url);
        if (!res.ok) {
          throw new Error(`Feed ${feed.id}: HTTP ${res.status}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        return parseFeed(feed.id, buf);
      }),
    );

    const allVehicles: ParsedVehicle[] = [];
    const allTripUpdates: ParsedTripUpdate[] = [];
    let successCount = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
        allVehicles.push(...result.value.vehicles);
        allTripUpdates.push(...result.value.tripUpdates);
      } else {
        console.warn(`${mode} feed error: ${result.reason}`);
      }
    }

    const trains = interpolatePositions(allVehicles, allTripUpdates, gtfs);
    updateCache(mode, trains);

    const elapsed = Date.now() - startTime;
    console.log(
      `Poll ${mode} in ${elapsed}ms: ${successCount}/${feeds.length} feeds ok, ` +
        `${allVehicles.length} vehicles, ${allTripUpdates.length} trip updates, ` +
        `${trains.length} positioned trains`,
    );
  } catch (err) {
    console.error(`${mode} poll failed:`, err);
  }
}
