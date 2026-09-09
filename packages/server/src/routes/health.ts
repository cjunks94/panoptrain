import { Hono } from "hono";
import type { HealthResponse, Mode, PollerHealth } from "@panoptrain/shared";
import { getPollerState } from "../services/poller-status.js";

const ALL_MODES: Mode[] = ["subway", "lirr"];

/**
 * Build the /api/health router (#143).
 *
 * Railway polls this path to decide whether a new revision is promoted
 * (railway.toml). Three outcomes:
 *
 * - `error` (503): a required poller never started — the GTFS load threw at
 *   boot, so the revision would serve an empty map forever. Fail the check
 *   so the previous revision stays up.
 * - `degraded` (200): every required poller is running but the last poll
 *   fell back to cache or dropped a feed. Still healthy from the process's
 *   point of view — restarting would not fix an upstream MTA outage, and a
 *   restart would lose the fallback cache that is keeping trains visible.
 * - `ok` (200).
 *
 * Optional pollers (LIRR, which index.ts skips when its static dump is
 * absent) are reported but never affect the status.
 */
export function createHealthRouter(opts: { required: Mode[] }): Hono {
  const required = new Set(opts.required);
  const health = new Hono();

  health.get("/", (c) => {
    const now = Date.now();
    const pollers = {} as Record<Mode, PollerHealth>;
    let status: HealthResponse["status"] = "ok";

    for (const mode of ALL_MODES) {
      const s = getPollerState(mode);
      const isRequired = required.has(mode);
      pollers[mode] = {
        required: isRequired,
        started: s.started,
        startedAt: s.startedAt,
        lastPollAt: s.lastPollAt,
        lastPollAgeS: s.lastPollAt === null ? null : Math.max(0, Math.round((now - s.lastPollAt) / 1000)),
        degradedFeeds: s.degradedFeeds,
        error: s.error,
      };
      if (isRequired && !s.started) status = "error";
      else if (isRequired && s.degradedFeeds.length > 0 && status === "ok") status = "degraded";
    }

    const body: HealthResponse = { status, uptime: process.uptime(), pollers };
    return c.json(body, status === "error" ? 503 : 200);
  });

  return health;
}
