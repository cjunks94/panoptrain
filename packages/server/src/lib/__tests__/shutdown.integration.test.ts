import { describe, it, expect, vi } from "vitest";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createShutdownHandler, connectionClosers } from "../shutdown.js";

/**
 * Integration coverage for #129 against a real @hono/node-server instance.
 *
 * Scope note: this exercises everything except OS signal delivery — the
 * `process.on("SIGTERM", ...)` registration in index.ts is not covered here,
 * because Windows cannot deliver a real SIGTERM to another process (Node
 * documents SIGTERM as listenable but not raisable on Windows). What matters
 * behaviourally, and what this asserts, is that once the handler runs an
 * in-flight request is *drained* rather than aborted, and the listener is
 * actually released.
 */
describe("shutdown against a real server", () => {
  it("should let an in-flight request finish instead of truncating it", async () => {
    const app = new Hono();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    app.get("/slow", async (c) => {
      await gate; // hold the response open across the shutdown call
      return c.text("complete payload");
    });

    const server = serve({ fetch: app.fetch, port: 0 });
    const port = (server.address() as { port: number }).port;

    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      closeServer: (done) => server.close(() => done()),
      ...connectionClosers(server),
      stopPollers: () => {},
      exit,
      graceMs: 5_000,
    });

    // Start the request, wait until the handler is definitely engaged.
    const inFlight = fetch(`http://127.0.0.1:${port}/slow`);
    await new Promise((r) => setTimeout(r, 50));

    shutdown("SIGTERM");

    // Server is closing, but the open request must still complete fully.
    release();
    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("complete payload");

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });

  it("should stop accepting new connections once shutdown begins", async () => {
    const app = new Hono();
    app.get("/ping", (c) => c.text("pong"));

    const server = serve({ fetch: app.fetch, port: 0 });
    const port = (server.address() as { port: number }).port;

    // Sanity: reachable before shutdown.
    expect(await (await fetch(`http://127.0.0.1:${port}/ping`)).text()).toBe("pong");

    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      closeServer: (done) => server.close(() => done()),
      ...connectionClosers(server),
      stopPollers: () => {},
      exit,
      graceMs: 5_000,
    });

    shutdown("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    // Listener released — a fresh connection must now be refused.
    await expect(fetch(`http://127.0.0.1:${port}/ping`)).rejects.toThrow();
  });

  it("should call every poller stop function exactly once", async () => {
    const app = new Hono();
    const server = serve({ fetch: app.fetch, port: 0 });

    const stops = {
      mta: vi.fn(),
      airspace: vi.fn(),
      metar: vi.fn(),
      taf: vi.fn(),
    };
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      closeServer: (done) => server.close(() => done()),
      ...connectionClosers(server),
      stopPollers: () => {
        stops.mta();
        stops.airspace();
        stops.metar();
        stops.taf();
      },
      exit,
      graceMs: 5_000,
    });

    shutdown("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    for (const [name, fn] of Object.entries(stops)) {
      expect(fn, `${name} poller must be stopped`).toHaveBeenCalledOnce();
    }
  });
});
