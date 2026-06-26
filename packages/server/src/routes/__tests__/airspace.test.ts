import { describe, it, expect, beforeEach } from "vitest";
import { AirspaceResponseSchema } from "@panoptrain/shared";
import airspace from "../airspace.js";
import {
  __TEST_INTERNALS__,
  getCurrentAirspaceSnapshot,
} from "../../services/airspace-poller.js";

/**
 * Route surface only — the poller's own resilience is tested in
 * services/__tests__. Here we just confirm the 503-when-empty contract,
 * the 200 + cache header path, and the response shape against the shared
 * Zod schema (so accidental drift from the type can't ship).
 */
async function get(path: string) {
  return airspace.request(path);
}

beforeEach(() => {
  __TEST_INTERNALS__.reset();
});

describe("GET /api/airspace/aircraft", () => {
  it("returns 503 when no snapshot has been produced yet", async () => {
    const res = await get("/aircraft");
    expect(res.status).toBe(503);
  });

  it("returns 200 with a schema-conformant body once a snapshot exists", async () => {
    // Reach into the poller module's mutable snapshot via the only path
    // production uses — running a real fetch is overkill for this test
    // since the parsing layer has its own coverage. Instead, mock fetch
    // through the poller and call its internal pollOnce indirectly.
    // The simplest seam available is `fetchAircraftSnapshot` plus direct
    // assignment, which we don't expose; so we test via a fetch mock.
    const { startAirspacePolling, stopAirspacePolling } = await import(
      "../../services/airspace-poller.js"
    );
    const fakeNow = 1_700_000_000_000;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            now: fakeNow,
            ac: [
              { hex: "abc", lat: 40.7, lon: -73.9, seen: 0 },
              { hex: "def", lat: 40.8, lon: -74.0, seen: 1.5 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )) as typeof globalThis.fetch;

    try {
      // Long interval — we only need the initial immediate pollOnce.
      startAirspacePolling(60_000);
      // Yield to let the initial poll resolve before we assert.
      await new Promise((r) => setTimeout(r, 10));
      stopAirspacePolling();

      // Sanity: the poller should have stored a snapshot.
      expect(getCurrentAirspaceSnapshot()).not.toBeNull();

      const res = await get("/aircraft");
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=5");
      const body = await res.json();
      expect(() => AirspaceResponseSchema.parse(body)).not.toThrow();
      expect(body).toMatchObject({ count: 2, source: "live" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
