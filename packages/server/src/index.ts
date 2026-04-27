import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStaticGtfs } from "./services/gtfs-loader.js";
import { startPolling } from "./services/mta-poller.js";
import { createTrainsRouter } from "./routes/trains.js";
import { createStaticRouter } from "./routes/static.js";
import plan from "./routes/plan.js";

// Load env
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "30000", 10);

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

// Legacy aliases — subway-only. Trip planner is subway-only by design (PT-508).
app.route("/api/trains", subwayTrains);
app.route("/api/plan", plan);
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
  startPolling("subway", subwayGtfs, POLL_INTERVAL);
} catch (err) {
  console.error("Failed to load subway GTFS data:", err);
  console.error('Run "pnpm download-gtfs" to download and process the data first.');
}

try {
  const lirrGtfs = loadStaticGtfs("lirr");
  startPolling("lirr", lirrGtfs, POLL_INTERVAL);
} catch (err) {
  console.warn("LIRR GTFS data not available — skipping. Run \"pnpm download-gtfs lirr\" to enable LIRR.");
}

console.log(`Panoptrain server starting on port ${PORT}...`);
serve({ fetch: app.fetch, port: PORT });
console.log(`Server running at http://localhost:${PORT}`);
