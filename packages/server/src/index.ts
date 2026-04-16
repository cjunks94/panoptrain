import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadStaticGtfs } from "./services/gtfs-loader.js";
import { startPolling } from "./services/mta-poller.js";
import trains from "./routes/trains.js";
import staticRoutes from "./routes/static.js";
import plan from "./routes/plan.js";

// Load env
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);

const app = new Hono();

// CORS for local development
app.use("/*", cors({ origin: "*" }));

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

// API routes
app.route("/api/trains", trains);
app.route("/api/plan", plan);
app.route("/api", staticRoutes);

// Load static GTFS data and start polling
try {
  const gtfs = loadStaticGtfs();
  startPolling(gtfs, POLL_INTERVAL);
} catch (err) {
  console.error("Failed to load static GTFS data:", err);
  console.error('Run "pnpm download-gtfs" to download and process the data first.');
}

console.log(`Panoptrain server starting on port ${PORT}...`);
serve({ fetch: app.fetch, port: PORT });
console.log(`Server running at http://localhost:${PORT}`);
