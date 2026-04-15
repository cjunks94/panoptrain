import { Hono } from "hono";
import { getCurrentSnapshot } from "../services/cache.js";
import type { TrainsResponse } from "@panoptrain/shared";

const trains = new Hono();

trains.get("/", (c) => {
  const snapshot = getCurrentSnapshot();

  if (!snapshot) {
    return c.json({ timestamp: 0, count: 0, trains: [] } satisfies TrainsResponse);
  }

  // Evict trains not updated in the last 5 minutes — likely stale feed artifacts
  const TTL = 300; // seconds
  const now = Math.floor(Date.now() / 1000);
  let filtered = snapshot.trains.filter((t) => now - t.updatedAt < TTL);

  // Optional route filter
  const routeFilter = c.req.query("routes");
  if (routeFilter) {
    const routes = new Set(routeFilter.split(",").map((r) => r.trim().toUpperCase()));
    filtered = filtered.filter((t) => routes.has(t.routeId.toUpperCase()));
  }

  const response: TrainsResponse = {
    timestamp: snapshot.timestamp,
    count: filtered.length,
    trains: filtered,
  };

  return c.json(response);
});

export default trains;
