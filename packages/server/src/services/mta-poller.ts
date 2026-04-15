import { SUBWAY_FEEDS } from "@panoptrain/shared";
import { parseFeed } from "./feed-parser.js";
import { interpolatePositions } from "./position-interpolator.js";
import { updateCache } from "./cache.js";
import type { StaticGtfsData } from "./gtfs-loader.js";
import type { ParsedVehicle, ParsedTripUpdate } from "@panoptrain/shared";

let pollInterval: ReturnType<typeof setInterval> | null = null;

export function startPolling(gtfs: StaticGtfsData, intervalMs: number): void {
  console.log(`Starting MTA feed polling every ${intervalMs / 1000}s...`);

  // Poll immediately, then on interval
  pollFeeds(gtfs);
  pollInterval = setInterval(() => pollFeeds(gtfs), intervalMs);
}

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function pollFeeds(gtfs: StaticGtfsData): Promise<void> {
  const startTime = Date.now();

  try {
    // Fetch all feeds in parallel
    const results = await Promise.allSettled(
      SUBWAY_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url);
        if (!res.ok) {
          throw new Error(`Feed ${feed.id}: HTTP ${res.status}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        return parseFeed(feed.id, buf);
      }),
    );

    // Merge all successful feed results
    const allVehicles: ParsedVehicle[] = [];
    const allTripUpdates: ParsedTripUpdate[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        successCount++;
        allVehicles.push(...result.value.vehicles);
        allTripUpdates.push(...result.value.tripUpdates);
      } else {
        failCount++;
        console.warn(`Feed error: ${result.reason}`);
      }
    }

    // Interpolate positions
    const trains = interpolatePositions(allVehicles, allTripUpdates, gtfs);
    updateCache(trains);

    const elapsed = Date.now() - startTime;
    console.log(
      `Poll complete in ${elapsed}ms: ${successCount}/${SUBWAY_FEEDS.length} feeds ok, ` +
        `${allVehicles.length} vehicles, ${allTripUpdates.length} trip updates, ` +
        `${trains.length} positioned trains`,
    );
  } catch (err) {
    console.error("Poll failed:", err);
  }
}
