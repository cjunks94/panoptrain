/**
 * MSW handlers for e2e tests — intercepts MTA GTFS-RT and adsb.lol calls
 * at the Node fetch layer and replies with captured fixture bytes. The
 * pollers (mta-poller, airspace-poller) are unmodified; they fetch as
 * usual but get our canned responses instead of hitting the real
 * upstreams. Tests get deterministic data, no network latency, and zero
 * upstream dependency.
 *
 * Loaded only by index-e2e.ts, which is the entry point Playwright's
 * webServer runs in e2e mode. The regular `dev` and `start` scripts go
 * through index.ts and never touch this module.
 *
 * Fixture refresh: re-run packages/e2e/fixtures/upstream/refresh.sh
 * (or curl the URLs in this file individually) when the upstream shape
 * changes — captures are committed so tests don't need network at run
 * time, but they should be refreshed periodically (~quarterly) to
 * track schema drift.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve to the e2e package's fixture dir relative to *this* file's
// location. tsx + watch mode preserves the source path so the URL
// arithmetic works in dev:e2e too.
const FIXTURES_DIR = fileURLToPath(new URL("../../e2e/fixtures/upstream/", import.meta.url));

function pbResponse(file: string) {
  return new HttpResponse(readFileSync(FIXTURES_DIR + file), {
    headers: { "content-type": "application/octet-stream" },
  });
}

function jsonFixture(file: string) {
  return JSON.parse(readFileSync(FIXTURES_DIR + file, "utf-8"));
}

const MTA_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds";

// Each MTA feed gets an explicit handler — listing them out is verbose
// but unambiguous (MSW's path-param matching can mishandle URL-encoded
// slashes, and these URLs require %2F to remain encoded).
const handlers = [
  http.get(`${MTA_BASE}/nyct%2Fgtfs`,        () => pbResponse("mta-gtfs.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-ace`,    () => pbResponse("mta-gtfs-ace.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-bdfm`,   () => pbResponse("mta-gtfs-bdfm.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-nqrw`,   () => pbResponse("mta-gtfs-nqrw.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-jz`,     () => pbResponse("mta-gtfs-jz.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-l`,      () => pbResponse("mta-gtfs-l.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-g`,      () => pbResponse("mta-gtfs-g.pb")),
  http.get(`${MTA_BASE}/nyct%2Fgtfs-si`,     () => pbResponse("mta-gtfs-si.pb")),
  http.get(`${MTA_BASE}/lirr%2Fgtfs-lirr`,   () => pbResponse("mta-gtfs-lirr.pb")),
  http.get("https://api.adsb.lol/v2/lat/40.75/lon/-73.97/dist/40", () =>
    HttpResponse.json(jsonFixture("adsb-aircraft.json")),
  ),
];

export const e2eServer = setupServer(...handlers);

// Bypass localhost (server talks to itself for health checks, etc.) but
// throw on any unmocked external request. Default "bypass" silently
// allows unhandled requests, which would let a newly added upstream
// fetch leak to the real network — exactly the determinism failure mode
// this whole module exists to prevent.
e2eServer.listen({
  onUnhandledRequest(request) {
    const host = new URL(request.url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return;
    throw new Error(`[e2e-mocks] Unmocked external request: ${request.method} ${request.url}`);
  },
});
console.log(`[e2e-mocks] MSW intercepting ${handlers.length} upstream URLs`);
