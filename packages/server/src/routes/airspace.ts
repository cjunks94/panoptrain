import { Hono } from "hono";
import type { AirspaceResponse } from "@panoptrain/shared";
import { getCurrentAirspaceSnapshot } from "../services/airspace-poller.js";

const airspace = new Hono();

airspace.get("/aircraft", (c) => {
  const snap = getCurrentAirspaceSnapshot();
  if (!snap) {
    // Distinct from "no aircraft in view" (which would be a 200 with an
    // empty array) — 503 means the poller hasn't produced a snapshot yet.
    return c.json(
      { error: "Airspace data not available — poller has not produced a snapshot yet" },
      503,
    );
  }
  // Match the poll cadence so we don't churn cache on every browser tick,
  // but stay short enough that aircraft motion is visible.
  c.header("Cache-Control", "public, max-age=5");
  return c.json({
    timestamp: snap.timestamp,
    sourceTimestamp: snap.sourceTimestamp,
    count: snap.aircraft.length,
    aircraft: snap.aircraft,
    source: snap.source,
  } satisfies AirspaceResponse);
});

export default airspace;
