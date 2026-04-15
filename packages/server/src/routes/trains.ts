import { Hono } from "hono";
import { getCurrentSnapshot } from "../services/cache.js";
import type { TrainsResponse } from "@panoptrain/shared";

const trains = new Hono();

trains.get("/", (c) => {
  const snapshot = getCurrentSnapshot();

  if (!snapshot) {
    return c.json({ timestamp: 0, count: 0, trains: [] } satisfies TrainsResponse);
  }

  // Optional route filter
  const routeFilter = c.req.query("routes");
  let filtered = snapshot.trains;

  if (routeFilter) {
    const routes = new Set(routeFilter.split(",").map((r) => r.trim().toUpperCase()));
    filtered = snapshot.trains.filter((t) => routes.has(t.routeId.toUpperCase()));
  }

  const response: TrainsResponse = {
    timestamp: snapshot.timestamp,
    count: filtered.length,
    trains: filtered,
  };

  return c.json(response);
});

export default trains;
