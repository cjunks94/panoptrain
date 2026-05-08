import { describe, it, expect } from "vitest";
import planLirr from "../plan-lirr.js";

/**
 * These tests cover only the input-validation surface of /plan/lirr — the
 * shape of `at`, its drift window, and missing params. We don't load LIRR
 * data here because CI has no GTFS feed; valid-time integration belongs in
 * a higher-level test once the loader can be stubbed.
 */
async function get(path: string) {
  return planLirr.request(path);
}

describe("GET /plan/lirr — input validation", () => {
  it("returns 400 if from is missing", async () => {
    const res = await get("/?to=237");
    expect(res.status).toBe(400);
  });

  it("returns 400 if to is missing", async () => {
    const res = await get("/?from=237");
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'at' is missing a timezone offset", async () => {
    const res = await get("/?from=237&to=241&at=2026-05-08T08:00:00");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/timezone offset/);
  });

  it("returns 400 when 'at' is unparseable", async () => {
    const res = await get("/?from=237&to=241&at=not-a-dateZ");
    expect(res.status).toBe(400);
  });

  it("returns 400 when 'at' is more than 7 days in the past", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await get(`/?from=237&to=241&at=${encodeURIComponent(eightDaysAgo)}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/within ±7 days/);
  });

  it("returns 400 when 'at' is more than 7 days in the future", async () => {
    const eightDaysAhead = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await get(`/?from=237&to=241&at=${encodeURIComponent(eightDaysAhead)}`);
    expect(res.status).toBe(400);
  });

  it("accepts 'at' inside the ±7d window (request gets past validation)", async () => {
    // The request will progress past validation; if LIRR data isn't loaded,
    // it returns 503 (data unavailable), which still proves the validator
    // didn't reject. Either 200/404/503 indicates "validator passed".
    const justAhead = new Date(Date.now() + 60_000).toISOString();
    const res = await get(`/?from=237&to=241&at=${encodeURIComponent(justAhead)}`);
    expect([200, 404, 503]).toContain(res.status);
  });
});
