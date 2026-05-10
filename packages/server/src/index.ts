import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStaticGtfs } from "./services/gtfs-loader.js";
import { startPolling } from "./services/mta-poller.js";
import { startAirspacePolling } from "./services/airspace-poller.js";
import { startMetarPolling } from "./services/metar-poller.js";
import { startTafPolling } from "./services/taf-poller.js";
import { prewarmInterpolator } from "./services/position-interpolator.js";
import { createTrainsRouter } from "./routes/trains.js";
import { createStaticRouter } from "./routes/static.js";
import plan from "./routes/plan.js";
import planLirr from "./routes/plan-lirr.js";
import airspace from "./routes/airspace.js";

// Load env
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);
// Airspace overlay is gated so we can dark-launch / disable in environments
// where outbound HTTPS to adsb.lol isn't available (sealed CI, offline dev).
// Default on — the route returns 503 cleanly if the poller can't reach the
// upstream, so the worst case is "no aircraft yet" rather than a crash.
const AIRSPACE_ENABLED = (process.env.AIRSPACE_ENABLED ?? "true") !== "false";
const AIRSPACE_POLL_INTERVAL = parseInt(process.env.AIRSPACE_POLL_INTERVAL_MS ?? "8000", 10);
// METARs only update hourly so polling faster wastes upstream cycles.
// 15 minutes catches special reports (SPECI) without thrashing.
const METAR_POLL_INTERVAL = parseInt(process.env.METAR_POLL_INTERVAL_MS ?? "900000", 10);
// TAFs issue every 6h with mid-cycle amendments. 30 minutes catches
// amendments inside one polling window without putting needless load
// on the upstream — TAFs change far less frequently than METARs.
const TAF_POLL_INTERVAL = parseInt(process.env.TAF_POLL_INTERVAL_MS ?? "1800000", 10);

const app = new Hono();

// CORS for local development
app.use("/*", cors({ origin: "*" }));

// gzip/deflate JSON API responses (PT-103). Default 1024 byte threshold means
// tiny endpoints like /api/health pass through uncompressed. /api/trains and
// /api/routes shrink ~70% — the route GeoJSON in particular is multi-MB.
//
// Ordering: any middleware that mutates the response body MUST be registered
// BEFORE compress() — mutations after compression would corrupt the gzipped
// bytes. CORS only sets headers, so it's safely ordered above.
app.use("/api/*", compress());

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", uptime: process.uptime() }));

// Per-mode API routes (PT-503). Subway also exposed at the legacy /api/trains
// and /api (routes/stops) paths so existing clients keep working during the
// transition to mode-aware endpoints.
const subwayTrains = createTrainsRouter("subway");
const lirrTrains = createTrainsRouter("lirr");
const subwayStatic = createStaticRouter("subway");
const lirrStatic = createStaticRouter("lirr");

app.route("/api/subway/trains", subwayTrains);
app.route("/api/lirr/trains", lirrTrains);
app.route("/api/subway", subwayStatic);
app.route("/api/lirr", lirrStatic);

// Legacy aliases — subway-only.
app.route("/api/trains", subwayTrains);
// LIRR planner mounted BEFORE the (subway) /api/plan so the more specific
// path matches first — Hono dispatches by registration order.
app.route("/api/plan/lirr", planLirr);
app.route("/api/plan", plan);
app.route("/api/airspace", airspace);
app.route("/api", subwayStatic);

// In production, serve the built client files
const clientDist = join(fileURLToPath(import.meta.url), "../../../client/dist");
if (existsSync(join(clientDist, "index.html"))) {
  const indexHtml = readFileSync(join(clientDist, "index.html"), "utf-8");
  const mimeTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };

  app.get("*", (c) => {
    // Try to serve the static file
    const filePath = join(clientDist, c.req.path);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const mime = mimeTypes[ext] ?? "application/octet-stream";
      c.header("Content-Type", mime);
      c.header("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
      return c.body(readFileSync(filePath));
    }
    // SPA fallback
    return c.html(indexHtml);
  });
  console.log("Serving client from", clientDist);
}

// Load static GTFS data and start polling — subway is required, LIRR is
// optional (logs a warning and skips if data isn't downloaded yet).
try {
  const subwayGtfs = loadStaticGtfs("subway");
  prewarmInterpolator(subwayGtfs);
  startPolling("subway", subwayGtfs, POLL_INTERVAL);
} catch (err) {
  console.error("Failed to load subway GTFS data:", err);
  console.error('Run "pnpm download-gtfs" to download and process the data first.');
}

try {
  const lirrGtfs = loadStaticGtfs("lirr");
  prewarmInterpolator(lirrGtfs);
  startPolling("lirr", lirrGtfs, POLL_INTERVAL);
} catch (err) {
  console.warn("LIRR GTFS data not available — skipping. Run \"pnpm download-gtfs lirr\" to enable LIRR.");
}

if (AIRSPACE_ENABLED) {
  startAirspacePolling(AIRSPACE_POLL_INTERVAL);
  // METAR + TAF share the airspace gate — same upstream-availability
  // concerns apply (sealed CI, offline dev) and the popup rows are only
  // useful on the airspace tab anyway.
  startMetarPolling(METAR_POLL_INTERVAL);
  startTafPolling(TAF_POLL_INTERVAL);
} else {
  console.log("Airspace polling disabled via AIRSPACE_ENABLED=false");
}

console.log(`Panoptrain server starting on port ${PORT}...`);
serve({ fetch: app.fetch, port: PORT });
console.log(`Server running at http://localhost:${PORT}`);
