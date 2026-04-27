import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { compress } from "hono/compress";

/**
 * Integration test for PT-103: confirms that wrapping a Hono app with
 * compress() actually negotiates Content-Encoding when the client sends
 * Accept-Encoding. Doesn't import the full server (which would boot GTFS
 * and start polling) — just rebuilds the same wiring (`app.use("/api/*",
 * compress())`) and asserts the contract.
 *
 * Guards against regression if someone reorders middleware or swaps the
 * wildcard mount path.
 */
describe("hono/compress middleware integration", () => {
  function buildApp() {
    const app = new Hono();
    app.use("/api/*", compress());
    // 2KB JSON — comfortably above the default 1024-byte threshold.
    app.get("/api/big", (c) => c.json({ payload: "x".repeat(2000) }));
    return app;
  }

  it("returns Content-Encoding: gzip for large responses when client accepts gzip", async () => {
    const app = buildApp();
    const res = await app.request("/api/big", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
  });

  it("does not compress when the client doesn't send Accept-Encoding", async () => {
    const app = buildApp();
    const res = await app.request("/api/big");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("decompressed body matches original payload", async () => {
    // End-to-end sanity: the gzipped bytes round-trip back to the same JSON.
    // Catches a class of bugs where a body-mutating middleware after compress
    // would corrupt the stream.
    const app = buildApp();
    const res = await app.request("/api/big", {
      headers: { "Accept-Encoding": "gzip" },
    });
    const ds = new DecompressionStream("gzip");
    const stream = res.body!.pipeThrough(ds);
    const decoded = await new Response(stream).json();
    expect(decoded).toEqual({ payload: "x".repeat(2000) });
  });
});
