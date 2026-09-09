import { describe, it, expect, beforeEach } from "vitest";
import { createHealthRouter } from "../health.js";
import {
  markPollerStarted,
  recordPollerStartupFailure,
  recordPollResult,
  _resetPollerStatusForTests,
} from "../../services/poller-status.js";
import type { HealthResponse } from "@panoptrain/shared";

/**
 * /api/health is Railway's promotion gate (railway.toml healthcheckPath).
 * Before #143 it answered `{ status: "ok" }` unconditionally, so a revision
 * whose GTFS load threw at boot — no poller, /api/trains empty forever —
 * still passed the check and replaced the healthy one.
 */
const health = createHealthRouter({ required: ["subway"] });

async function get(): Promise<{ status: number; body: HealthResponse }> {
  const res = await health.request("/");
  return { status: res.status, body: (await res.json()) as HealthResponse };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    _resetPollerStatusForTests();
  });

  it("fails with 503 when a required poller never started", async () => {
    const { status, body } = await get();

    expect(status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.pollers.subway.required).toBe(true);
    expect(body.pollers.subway.started).toBe(false);
  });

  it("reports why a required poller failed to start", async () => {
    recordPollerStartupFailure("subway", new Error("ENOENT: stops.json"));

    const { status, body } = await get();

    expect(status).toBe(503);
    expect(body.pollers.subway.error).toContain("ENOENT");
  });

  it("is ok once required pollers are running with every feed live", async () => {
    markPollerStarted("subway");
    recordPollResult("subway", []);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.pollers.subway.started).toBe(true);
    expect(body.pollers.subway.lastPollAgeS).toBeGreaterThanOrEqual(0);
    expect(body.pollers.subway.degradedFeeds).toEqual([]);
  });

  it("reports degraded, still 200, when the last poll fell back on any feed", async () => {
    // A single MTA feed being down must not fail the healthcheck — that
    // would make Railway restart a process that is doing the right thing.
    markPollerStarted("subway");
    recordPollResult("subway", ["gtfs-ace"]);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.pollers.subway.degradedFeeds).toEqual(["gtfs-ace"]);
  });

  it("does not fail for an optional poller that never started", async () => {
    // LIRR data is optional (index.ts skips it with a warning when the
    // static dump is absent); its absence is informational only.
    markPollerStarted("subway");
    recordPollResult("subway", []);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.pollers.lirr.required).toBe(false);
    expect(body.pollers.lirr.started).toBe(false);
  });

  it("has no lastPollAge before the first poll completes", async () => {
    markPollerStarted("subway");

    const { body } = await get();

    expect(body.pollers.subway.started).toBe(true);
    expect(body.pollers.subway.lastPollAt).toBeNull();
    expect(body.pollers.subway.lastPollAgeS).toBeNull();
  });
});
