import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadStaticGtfs, loadLirrSchedule } from "../gtfs-loader.js";
import type { StaticGtfsData, LirrScheduleData } from "../gtfs-loader.js";
import { planLirrTrips, clearLirrPlannerCache } from "../lirr-trip-planner.js";

// Stop IDs (from data/gtfs-lirr/stops.json)
const PENN = "237";
const JAMAICA = "102";
const BABYLON = "27";
const HEMPSTEAD = "84";
const ATLANTIC = "241";

let gtfs: StaticGtfsData;
let schedule: LirrScheduleData;
// 3 PM NY-local on the first weekday inside the loaded calendar_dates window
// with ≥5 active services. Derived per-snapshot so the test moves with
// schedule rotation instead of going stale on a hardcoded date. See
// docs/adr/001-lirr-test-planning-date.md.
let PLANNING_EPOCH_MS: number;
let PLANNING_ISO_DATE: string;

beforeAll(() => {
  gtfs = loadStaticGtfs("lirr");
  schedule = loadLirrSchedule();
  const picked = pickPlanningTimestamp(schedule);
  PLANNING_EPOCH_MS = picked.epochMs;
  PLANNING_ISO_DATE = picked.isoDate;
});

function pickPlanningTimestamp(schedule: LirrScheduleData): {
  epochMs: number;
  isoDate: string;
} {
  const countsByDate = new Map<string, number>();
  for (const r of schedule.calendarDates) {
    if (r.exceptionType === 1) {
      countsByDate.set(r.date, (countsByDate.get(r.date) ?? 0) + 1);
    }
  }
  const sorted = [...countsByDate.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [yyyymmdd, count] of sorted) {
    if (count < 5) continue;
    const y = parseInt(yyyymmdd.slice(0, 4), 10);
    const m = parseInt(yyyymmdd.slice(4, 6), 10);
    const d = parseInt(yyyymmdd.slice(6, 8), 10);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow < 1 || dow > 5) continue;
    return {
      epochMs: nyLocalEpochMs(y, m, d, 15, 0),
      isoDate: `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`,
    };
  }
  throw new Error(
    "no weekday with ≥5 active services found in LIRR schedule — " +
      "data may be stale or empty",
  );
}

function nyLocalEpochMs(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
): number {
  const target = Date.UTC(y, m - 1, d, h, mi, 0);
  let ms = target;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(ms);
    const got = Date.UTC(
      +parts.find((p) => p.type === "year")!.value,
      +parts.find((p) => p.type === "month")!.value - 1,
      +parts.find((p) => p.type === "day")!.value,
      +parts.find((p) => p.type === "hour")!.value % 24,
      +parts.find((p) => p.type === "minute")!.value,
    );
    ms += target - got;
  }
  return ms;
}

afterEach(() => {
  clearLirrPlannerCache();
});

describe("lirr-trip-planner", () => {
  describe("direct trips", () => {
    it("returns plans for a high-frequency direct route (Penn → Babylon)", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      expect(result.plans.length).toBeGreaterThan(0);
      const first = result.plans[0];
      expect(first.transferCount).toBe(0);
      expect(first.from.stopId).toBe(PENN);
      expect(first.to.stopId).toBe(BABYLON);
      expect(first.segments).toHaveLength(1);
      expect(first.segments[0].type).toBe("ride");
    });

    it("ranks plans by arrival time ascending", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      for (let i = 1; i < result.plans.length; i++) {
        expect(result.plans[i].arriveAt).toBeGreaterThanOrEqual(result.plans[i - 1].arriveAt);
      }
    });

    it("returns at most 3 plans", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      expect(result.plans.length).toBeLessThanOrEqual(3);
    });

    it("includes a label with the boarding and arrival times", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      // Labels look like "3:13 PM → 4:15 PM"
      expect(result.plans[0].label).toMatch(/\d{1,2}:\d{2}\s?[AP]M\s*→\s*\d{1,2}:\d{2}\s?[AP]M/);
    });

    it("populates departAt and arriveAt as future timestamps", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      const first = result.plans[0];
      expect(first.departAt).toBeGreaterThanOrEqual(PLANNING_EPOCH_MS);
      expect(first.arriveAt).toBeGreaterThan(first.departAt);
    });

    it("populates ride segment with ordered intermediate stops", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      const ride = result.plans[0].segments[0];
      if (ride.type !== "ride") throw new Error("expected ride segment");
      expect(ride.stops.length).toBeGreaterThan(1);
      expect(ride.stops[0].stopId).toBe(PENN);
      expect(ride.stops[ride.stops.length - 1].stopId).toBe(BABYLON);
      // Each stop's arrival time should be non-decreasing.
      for (let i = 1; i < ride.stops.length; i++) {
        expect(ride.stops[i].arriveAt).toBeGreaterThanOrEqual(ride.stops[i - 1].arriveAt);
      }
    });

    it("populates routeId, tripId, and headsign on the ride segment", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      const ride = result.plans[0].segments[0];
      if (ride.type !== "ride") throw new Error("expected ride segment");
      expect(ride.routeId).toBeTruthy();
      expect(ride.tripId).toBeTruthy();
      expect(ride.tripHeadsign).toBeTruthy();
    });
  });

  describe("one-transfer trips", () => {
    it("finds a transfer plan for a pair with no direct service (Babylon → Hempstead)", () => {
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], PLANNING_EPOCH_MS);
      expect(result.plans.length).toBeGreaterThan(0);
      // No direct route exists on this date, so every plan must transfer.
      for (const p of result.plans) {
        expect(p.transferCount).toBe(1);
        expect(p.segments).toHaveLength(3);
        expect(p.segments[0].type).toBe("ride");
        expect(p.segments[1].type).toBe("transfer");
        expect(p.segments[2].type).toBe("ride");
      }
    });

    it("transfer station is typically Jamaica for Babylon → Hempstead", () => {
      // Jamaica is THE LIRR transfer hub — over 95% of cross-branch trips
      // route through it. Soft-asserted (any one plan is enough) since the
      // schedule could in theory route via a different shared stop.
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], PLANNING_EPOCH_MS);
      const viaJamaica = result.plans.some((p) =>
        p.segments.some((s) => s.type === "transfer" && s.atStopId === JAMAICA),
      );
      expect(viaJamaica).toBe(true);
    });

    it("transfer wait honors the minimum buffer", () => {
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], PLANNING_EPOCH_MS);
      for (const p of result.plans) {
        const transfer = p.segments.find((s) => s.type === "transfer");
        if (!transfer || transfer.type !== "transfer") continue;
        // 5-minute minimum buffer is enforced by the planner.
        expect(transfer.minutes).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe("input validation", () => {
    it("returns no plans when from and to overlap", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [PENN], PLANNING_EPOCH_MS);
      expect(result.plans).toHaveLength(0);
    });

    it("returns no plans for unknown stop IDs", () => {
      const result = planLirrTrips(gtfs, schedule, ["NOPE"], [PENN], PLANNING_EPOCH_MS);
      expect(result.plans).toHaveLength(0);
    });

    it("populates serviceDate as YYYY-MM-DD matching the GTFS service date used", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      expect(result.serviceDate).toBe(PLANNING_ISO_DATE);
    });
  });

  describe("service-day filtering", () => {
    it("returns no trips for a date with no active services", () => {
      // Pick a date far past the end of the schedule window — calendar_dates
      // shouldn't have any rows for it.
      const yearFromNow = PLANNING_EPOCH_MS + 365 * 24 * 3600 * 1000;
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], yearFromNow);
      expect(result.plans).toHaveLength(0);
    });
  });

  describe("look-ahead window", () => {
    it("does not return trips departing before the requested time", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], PLANNING_EPOCH_MS);
      for (const p of result.plans) {
        expect(p.departAt).toBeGreaterThanOrEqual(PLANNING_EPOCH_MS);
      }
    });
  });
});
