import { describe, it, expect } from "vitest";
import type { PlanResponse } from "@panoptrain/shared";
import plan from "../plan.js";

async function get(path: string) {
  return plan.request(path);
}

describe("GET /api/plan", () => {
  it("returns 400 if from is missing", async () => {
    const res = await get("/?to=127");
    expect(res.status).toBe(400);
  });

  it("returns 400 if to is missing", async () => {
    const res = await get("/?from=127");
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown stop ID", async () => {
    const res = await get("/?from=FAKE&to=127");
    expect(res.status).toBe(400);
  });

  it("returns 200 with at least a primary plan", async () => {
    const res = await get("/?from=127&to=132");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanResponse;
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.plans[0].from.stopId).toBe("127");
    expect(body.plans[0].label).toBe("Recommended");
    expect(body.plans[0].segments.length).toBeGreaterThan(0);
  });

  it("sets a short Cache-Control so live delays flow through", async () => {
    const res = await get("/?from=127&to=132");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("accepts comma-separated parent IDs for broad station selection", async () => {
    // Broad Times Sq (multiple parent stations sharing the name) -> 14 St
    const res = await get("/?from=127,723,902,R16&to=132");
    expect(res.status).toBe(200);
  });

  it("returns 400 if any ID in a comma-separated list is unknown", async () => {
    const res = await get("/?from=127,FAKE&to=132");
    expect(res.status).toBe(400);
  });

  // --- #127: bound the work a single request can cause ---

  it("rejects an over-long station ID list before doing any planning", async () => {
    const many = Array.from({ length: 50 }, (_, i) => `s${i}`).join(",");
    const started = Date.now();
    const res = await get(`/?from=${many}&to=132`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many 'from' station IDs/);
    // Must be rejected on the parse path, not after a search.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("bounds the 'to' list as well as 'from'", async () => {
    const many = Array.from({ length: 50 }, (_, i) => `s${i}`).join(",");
    const res = await get(`/?from=127&to=${many}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many 'to' station IDs/);
  });

  it("collapses a repeated ID instead of seeding the search once per copy", async () => {
    // The original DoS: 2600 copies of a valid ID passed validation and each
    // one seeded the Dijkstra frontier. Dedup makes this identical to a
    // single-ID request, so it must succeed and stay fast.
    const repeated = Array(2600).fill("127").join(",");
    const started = Date.now();
    const res = await get(`/?from=${repeated}&to=132`);
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns the same plan for a repeated ID as for the single ID", async () => {
    const single = (await (await get("/?from=127&to=132")).json()) as PlanResponse;
    const repeated = (await (
      await get(`/?from=${Array(20).fill("127").join(",")}&to=132`)
    ).json()) as PlanResponse;
    expect(repeated.plans).toEqual(single.plans);
  });

  it("still accepts the largest legitimate same-name station group", async () => {
    // 86 St and Canal St each have 6 parent stations — the real-world max.
    const res = await get("/?from=121,N10,725,A17,B20,R31&to=132");
    expect(res.status).toBe(200);
  });

  it("does not treat inherited Object properties as valid stop IDs", async () => {
    // gtfs.stops comes from JSON.parse, so it inherits Object.prototype and a
    // bare `gtfs.stops[id]` truthiness check passed for "constructor" etc.
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const res = await get(`/?from=${id}&to=132`);
      expect(res.status, `${id} must be rejected as unknown`).toBe(400);
    }
  });

  it("does not reflect the submitted stop ID back in the error", async () => {
    const res = await get("/?from=<script>alert(1)</script>&to=132");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("<script>");
  });
});
