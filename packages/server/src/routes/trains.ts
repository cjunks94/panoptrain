import { Hono } from "hono";
import { getCurrentSnapshot, getPreviousSnapshot } from "../services/cache.js";
import type { Mode, TrainPosition, TrainsResponse } from "@panoptrain/shared";

/** Build a `/api/<mode>/trains` router. Same logic for subway and LIRR;
 *  the only difference is which cached snapshot it reads. */
export function createTrainsRouter(mode: Mode): Hono {
  const trains = new Hono();

  trains.get("/", (c) => {
    const snapshot = getCurrentSnapshot(mode);

    // Snapshot only refreshes once per poll cycle — let intermediaries reuse
    // it for a few seconds. Short TTL keeps perceived freshness near-real-time.
    c.header("Cache-Control", "public, max-age=5");

    if (!snapshot) {
      return c.json({ timestamp: 0, count: 0, trains: [] } satisfies TrainsResponse);
    }

    // Evict trains not updated in the last 5 minutes — likely stale feed artifacts
    const TTL = 300; // seconds
    const now = Math.floor(Date.now() / 1000);
    const routeFilter = c.req.query("routes");
    const routeSet = routeFilter
      ? new Set(routeFilter.split(",").map((r) => r.trim().toUpperCase()))
      : null;

    function applyFilters(arr: TrainPosition[]): TrainPosition[] {
      let out = arr.filter((t) => now - t.updatedAt < TTL);
      if (routeSet) out = out.filter((t) => routeSet.has(t.routeId.toUpperCase()));
      return out;
    }

    const filtered = applyFilters(snapshot.trains);

    // Include the previous snapshot so the client can bootstrap motion on
    // its first poll instead of sitting at `prev = empty` for 30s. The
    // client interpolates from previous → current and starts animating on
    // the first frame. Filters are applied symmetrically so the client
    // sees a consistent train set across both snapshots.
    const previousSnapshot = getPreviousSnapshot(mode);
    const previous = previousSnapshot
      ? { timestamp: previousSnapshot.timestamp, trains: applyFilters(previousSnapshot.trains) }
      : undefined;

    const response: TrainsResponse = {
      timestamp: snapshot.timestamp,
      count: filtered.length,
      trains: filtered,
      previous,
    };

    return c.json(response);
  });

  return trains;
}
