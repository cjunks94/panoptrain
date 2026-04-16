import { Hono } from "hono";
import { loadStaticGtfs } from "../services/gtfs-loader.js";
import { buildStationGraph, planTrip, type StationGraph } from "../services/trip-planner.js";

let cachedGraph: StationGraph | null = null;

function getGraph(): StationGraph {
  if (!cachedGraph) {
    cachedGraph = buildStationGraph(loadStaticGtfs());
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

  const gtfs = loadStaticGtfs();
  if (!gtfs.stops[from]) {
    return c.json({ error: `Unknown stop ID: ${from}` }, 400);
  }
  if (!gtfs.stops[to]) {
    return c.json({ error: `Unknown stop ID: ${to}` }, 400);
  }

  const result = planTrip(getGraph(), gtfs, from, to);
  if (!result) {
    return c.json({ error: "No route found" }, 404);
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.json(result);
});

export default plan;
