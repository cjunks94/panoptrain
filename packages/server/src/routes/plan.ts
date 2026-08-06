import { Hono } from "hono";
import type { PlanResponse } from "@panoptrain/shared";
import { loadStaticGtfs } from "../services/gtfs-loader.js";
import { buildStationGraph, planTrips, type StationGraph } from "../services/trip-planner.js";
import { parseStationIds } from "../lib/station-ids.js";

// Trip planner is subway-only for now (PT-508) — LIRR is schedule-based and
// needs its own graph + planner.
let cachedGraph: StationGraph | null = null;

function getGraph(): StationGraph {
  if (!cachedGraph) {
    cachedGraph = buildStationGraph(loadStaticGtfs("subway"));
  }
  return cachedGraph;
}

const plan = new Hono();

plan.get("/", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (!from || !to) {
    return c.json({ error: "Missing 'from' or 'to' query parameter" }, 400);
  }

  // `from` / `to` may be a single stop ID or comma-separated list of parent
  // IDs (broad station selection across same-name parents). Deduped and
  // bounded before any planning work happens — see parseStationIds (#127).
  const fromParsed = parseStationIds(from, "from");
  if (!fromParsed.ok) return c.json({ error: fromParsed.error }, 400);
  const toParsed = parseStationIds(to, "to");
  if (!toParsed.ok) return c.json({ error: toParsed.error }, 400);
  const { ids: fromIds } = fromParsed;
  const { ids: toIds } = toParsed;

  const gtfs = loadStaticGtfs("subway");
  for (const id of [...fromIds, ...toIds]) {
    if (!Object.prototype.hasOwnProperty.call(gtfs.stops, id)) {
      return c.json({ error: "Unknown stop ID" }, 400);
    }
  }

  const plans = planTrips(getGraph(), gtfs, fromIds, toIds, 3);
  if (plans.length === 0) {
    return c.json({ error: "No route found" }, 404);
  }

  // Plans overlay live delays from the train snapshot — keep the cache short
  // so a fresh request after a delay change reflects current conditions.
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ plans } satisfies PlanResponse);
});

export default plan;
