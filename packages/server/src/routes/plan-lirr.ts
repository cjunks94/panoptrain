import { Hono } from "hono";
import type { LirrPlanResponse } from "@panoptrain/shared";
import { loadStaticGtfs, loadLirrSchedule } from "../services/gtfs-loader.js";
import { planLirrTrips } from "../services/lirr-trip-planner.js";

const planLirr = new Hono();

planLirr.get("/", (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const at = c.req.query("at");

  if (!from || !to) {
    return c.json({ error: "Missing 'from' or 'to' query parameter" }, 400);
  }

  const fromIds = from.split(",").map((s) => s.trim()).filter(Boolean);
  const toIds = to.split(",").map((s) => s.trim()).filter(Boolean);
  if (fromIds.length === 0 || toIds.length === 0) {
    return c.json({ error: "Empty 'from' or 'to' query parameter" }, 400);
  }

  // `at` accepts an ISO datetime; default to "now" when absent. Require an
  // explicit timezone offset (Z or ±HH:MM) — Date.parse interprets offset-less
  // strings as server-local time per ECMA-262, which would silently drift the
  // resolved epoch across deploy environments.
  let departAt = Date.now();
  if (at) {
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(at)) {
      return c.json(
        { error: "Invalid 'at' parameter — must include an explicit timezone offset (Z or ±HH:MM)" },
        400,
      );
    }
    const parsed = Date.parse(at);
    if (Number.isNaN(parsed)) {
      return c.json({ error: "Invalid 'at' parameter — expected ISO 8601 datetime" }, 400);
    }
    departAt = parsed;
  }

  let gtfs;
  let schedule;
  try {
    gtfs = loadStaticGtfs("lirr");
    schedule = loadLirrSchedule();
  } catch (err) {
    return c.json(
      { error: "LIRR data not available — server-side GTFS download required" },
      503,
    );
  }

  for (const id of [...fromIds, ...toIds]) {
    if (!gtfs.stops[id]) {
      return c.json({ error: `Unknown stop ID: ${id}` }, 400);
    }
  }

  const result = planLirrTrips(gtfs, schedule, fromIds, toIds, departAt);
  if (result.plans.length === 0) {
    return c.json({ error: "No trips found in the look-ahead window" }, 404);
  }

  // Short cache — schedule data is static but the implicit "now" departure
  // moves continuously, so a long cache would serve stale next-train info.
  c.header("Cache-Control", "public, max-age=30");
  return c.json({
    serviceDate: result.serviceDate,
    plans: result.plans,
  } satisfies LirrPlanResponse);
});

export default planLirr;
