import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { loadStaticGtfs, loadLirrSchedule } from "../gtfs-loader.js";
import type { StaticGtfsData, LirrScheduleData } from "../gtfs-loader.js";
import { planLirrTrips, clearLirrPlannerCache } from "../lirr-trip-planner.js";

// Stable test fixture: Monday, May 4, 2026, 3:00 PM NY-local. Falls during
// EDT (UTC-4) so the wall-time → UTC offset is fixed regardless of when the
// test runs. Verified against calendar_dates: 6 services active on this
// date with 961 trips, including 40 direct Penn → Babylon options.
const MONDAY_3PM_EPOCH_MS = Date.UTC(2026, 4, 4, 19, 0, 0); // 19:00 UTC = 15:00 EDT

// Stop IDs (from data/gtfs-lirr/stops.json)
const PENN = "237";
const JAMAICA = "102";
const BABYLON = "27";
const HEMPSTEAD = "84";
const ATLANTIC = "241";

let gtfs: StaticGtfsData;
let schedule: LirrScheduleData;

beforeAll(() => {
  gtfs = loadStaticGtfs("lirr");
  schedule = loadLirrSchedule();
});

afterEach(() => {
  clearLirrPlannerCache();
});

describe("lirr-trip-planner", () => {
  describe("direct trips", () => {
    it("returns plans for a high-frequency direct route (Penn → Babylon)", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      expect(result.plans.length).toBeGreaterThan(0);
      const first = result.plans[0];
      expect(first.transferCount).toBe(0);
      expect(first.from.stopId).toBe(PENN);
      expect(first.to.stopId).toBe(BABYLON);
      expect(first.segments).toHaveLength(1);
      expect(first.segments[0].type).toBe("ride");
    });

    it("ranks plans by arrival time ascending", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      for (let i = 1; i < result.plans.length; i++) {
        expect(result.plans[i].arriveAt).toBeGreaterThanOrEqual(result.plans[i - 1].arriveAt);
      }
    });

    it("returns at most 3 plans", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      expect(result.plans.length).toBeLessThanOrEqual(3);
    });

    it("includes a label with the boarding and arrival times", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      // Labels look like "3:13 PM → 4:15 PM"
      expect(result.plans[0].label).toMatch(/\d{1,2}:\d{2}\s?[AP]M\s*→\s*\d{1,2}:\d{2}\s?[AP]M/);
    });

    it("populates departAt and arriveAt as future timestamps", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      const first = result.plans[0];
      expect(first.departAt).toBeGreaterThanOrEqual(MONDAY_3PM_EPOCH_MS);
      expect(first.arriveAt).toBeGreaterThan(first.departAt);
    });

    it("populates ride segment with ordered intermediate stops", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
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
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      const ride = result.plans[0].segments[0];
      if (ride.type !== "ride") throw new Error("expected ride segment");
      expect(ride.routeId).toBeTruthy();
      expect(ride.tripId).toBeTruthy();
      expect(ride.tripHeadsign).toBeTruthy();
    });
  });

  describe("one-transfer trips", () => {
    it("finds a transfer plan for a pair with no direct service (Babylon → Hempstead)", () => {
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], MONDAY_3PM_EPOCH_MS);
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
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], MONDAY_3PM_EPOCH_MS);
      const viaJamaica = result.plans.some((p) =>
        p.segments.some((s) => s.type === "transfer" && s.atStopId === JAMAICA),
      );
      expect(viaJamaica).toBe(true);
    });

    it("transfer wait honors the minimum buffer", () => {
      const result = planLirrTrips(gtfs, schedule, [BABYLON], [HEMPSTEAD], MONDAY_3PM_EPOCH_MS);
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
      const result = planLirrTrips(gtfs, schedule, [PENN], [PENN], MONDAY_3PM_EPOCH_MS);
      expect(result.plans).toHaveLength(0);
    });

    it("returns no plans for unknown stop IDs", () => {
      const result = planLirrTrips(gtfs, schedule, ["NOPE"], [PENN], MONDAY_3PM_EPOCH_MS);
      expect(result.plans).toHaveLength(0);
    });

    it("populates serviceDate with the NY-local date string", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      expect(result.serviceDate).toBe("20260504");
    });
  });

  describe("service-day filtering", () => {
    it("returns no trips for a date with no active services", () => {
      // Pick a date far past the end of the schedule window — calendar_dates
      // shouldn't have any rows for it.
      const yearFromNow = MONDAY_3PM_EPOCH_MS + 365 * 24 * 3600 * 1000;
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], yearFromNow);
      expect(result.plans).toHaveLength(0);
    });
  });

  describe("look-ahead window", () => {
    it("does not return trips departing before the requested time", () => {
      const result = planLirrTrips(gtfs, schedule, [PENN], [BABYLON], MONDAY_3PM_EPOCH_MS);
      for (const p of result.plans) {
        expect(p.departAt).toBeGreaterThanOrEqual(MONDAY_3PM_EPOCH_MS);
      }
    });
  });
});
