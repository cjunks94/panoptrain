import { Hono } from "hono";
import type { AirspaceResponse, MetarsResponse } from "@panoptrain/shared";
import { getCurrentAirspaceSnapshot } from "../services/airspace-poller.js";
import { getCurrentMetarSnapshot } from "../services/metar-poller.js";

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

airspace.get("/metar", (c) => {
  const snap = getCurrentMetarSnapshot();
  if (!snap) {
    return c.json(
      { error: "METAR data not available — poller has not produced a snapshot yet" },
      503,
    );
  }
  // 60s of intermediary cache headroom — METARs only update hourly so
  // a longer max-age would be safe, but the poller's own state is
  // server-process-local and the popup is the only consumer; tighter
  // cache means fresher reads when the poller refreshes.
  c.header("Cache-Control", "public, max-age=60");
  return c.json(snap satisfies MetarsResponse);
});

export default airspace;
