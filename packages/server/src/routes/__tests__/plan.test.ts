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
});
