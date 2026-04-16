import { describe, it, expect } from "vitest";
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

  it("returns 200 with a valid plan", async () => {
    const res = await get("/?from=127&to=132");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: { stopId: string }; segments: unknown[] };
    expect(body.from.stopId).toBe("127");
    expect(body.segments.length).toBeGreaterThan(0);
  });
});
