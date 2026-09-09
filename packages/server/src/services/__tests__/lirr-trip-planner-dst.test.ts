import { describe, it, expect, afterEach } from "vitest";
import { planLirrTrips, clearLirrPlannerCache } from "../lirr-trip-planner.js";
import type { StaticGtfsData, LirrScheduleData } from "../gtfs-loader.js";

/**
 * DST service-day regression (#137).
 *
 * GTFS stop times are seconds after "noon minus twelve hours" of the service
 * day, not after midnight, precisely because a service day is 23 or 25 hours
 * long when it crosses a DST boundary. Adding seconds to NY midnight is right
 * on the other 363 days and one hour off on both transition days — for every
 * departure after 02:00 local, in the label and in the epoch the client
 * renders.
 *
 * The downloaded schedule never contains a transition day at the time of
 * writing (window 2026-05-01 … 2026-09-07), so these use a synthetic
 * schedule pinned to the 2026 transition dates.
 */

const SPRING_FORWARD = "20260308"; // EST → EDT at 02:00
const FALL_BACK = "20261101"; // EDT → EST at 02:00
const NORMAL_DAY = "20260806";

const STOP_A = "A";
const STOP_B = "B";

function makeGtfs(): StaticGtfsData {
  return {
    stops: {
      [STOP_A]: { stopId: STOP_A, stopName: "Alpha", lat: 40.75, lon: -73.99, parentStation: null },
      [STOP_B]: { stopId: STOP_B, stopName: "Beta", lat: 40.85, lon: -73.5, parentStation: null },
    },
    routes: { R: { routeId: "R", shortName: "R", longName: "Route", color: "000", textColor: "FFF" } },
    shapes: {},
    trips: {
      "day-trip": { tripId: "day-trip", routeId: "R", shapeId: "", directionId: 0, tripHeadsign: "Beta", serviceId: "SVC" },
      "night-trip": { tripId: "night-trip", routeId: "R", shapeId: "", directionId: 0, tripHeadsign: "Beta", serviceId: "SVC" },
    },
    stopSequences: {},
    stopDistances: {},
    transfers: [],
  };
}

/** One service, active only on the three dates under test, with a daytime
 *  trip (08:00 → 09:00) and an overnight trip (25:30 → 26:00, i.e. 1:30 AM
 *  the following calendar day). */
function makeSchedule(): LirrScheduleData {
  return {
    stopTimes: {
      "day-trip": [
        { stopId: STOP_A, stopSequence: 1, arrivalTime: "08:00:00", departureTime: "08:00:00" },
        { stopId: STOP_B, stopSequence: 2, arrivalTime: "09:00:00", departureTime: "09:00:00" },
      ],
      "night-trip": [
        { stopId: STOP_A, stopSequence: 1, arrivalTime: "25:30:00", departureTime: "25:30:00" },
        { stopId: STOP_B, stopSequence: 2, arrivalTime: "26:00:00", departureTime: "26:00:00" },
      ],
    },
    calendar: [],
    calendarDates: [SPRING_FORWARD, FALL_BACK, NORMAL_DAY].map((date) => ({
      serviceId: "SVC",
      date,
      exceptionType: 1 as const,
    })),
  };
}

/** Epoch ms of a NY wall-clock instant, resolved through Intl so the
 *  expectation does not share the implementation's arithmetic. */
function nyLocal(y: number, m: number, d: number, h: number, mi: number): number {
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

function planAt(departAt: number) {
  return planLirrTrips(makeGtfs(), makeSchedule(), [STOP_A], [STOP_B], departAt);
}

afterEach(() => {
  clearLirrPlannerCache();
});

describe("LIRR planner service-day arithmetic across DST (#137)", () => {
  // Sanity anchors: the two transition instants really are one hour apart in
  // UTC terms, i.e. Intl on this Node resolves the 2026 rules.
  it("test helper resolves the 2026 transitions", () => {
    expect(nyLocal(2026, 3, 8, 8, 0) - Date.UTC(2026, 2, 8, 12, 0)).toBe(0); // 08:00 EDT = 12:00Z
    expect(nyLocal(2026, 11, 1, 8, 0) - Date.UTC(2026, 10, 1, 13, 0)).toBe(0); // 08:00 EST = 13:00Z
  });

  it("keeps a normal day unchanged: 08:00:00 departs at 8:00 AM", () => {
    const { plans } = planAt(nyLocal(2026, 8, 6, 7, 0));
    const day = plans.find((p) => p.segments.some((s) => s.type === "ride" && s.tripId === "day-trip"))!;
    expect(day.departAt).toBe(nyLocal(2026, 8, 6, 8, 0));
    expect(day.arriveAt).toBe(nyLocal(2026, 8, 6, 9, 0));
    expect(day.label).toBe("8:00 AM → 9:00 AM");
  });

  it("spring forward: 08:00:00 on 2026-03-08 departs at 8:00 AM, not 9:00", () => {
    const { plans } = planAt(nyLocal(2026, 3, 8, 7, 0));
    const day = plans.find((p) => p.segments.some((s) => s.type === "ride" && s.tripId === "day-trip"))!;
    expect(day.departAt).toBe(nyLocal(2026, 3, 8, 8, 0));
    expect(day.arriveAt).toBe(nyLocal(2026, 3, 8, 9, 0));
    expect(day.label).toBe("8:00 AM → 9:00 AM");
  });

  it("fall back: 08:00:00 on 2026-11-01 departs at 8:00 AM, not 7:00", () => {
    const { plans } = planAt(nyLocal(2026, 11, 1, 7, 0));
    const day = plans.find((p) => p.segments.some((s) => s.type === "ride" && s.tripId === "day-trip"))!;
    expect(day.departAt).toBe(nyLocal(2026, 11, 1, 8, 0));
    expect(day.arriveAt).toBe(nyLocal(2026, 11, 1, 9, 0));
    expect(day.label).toBe("8:00 AM → 9:00 AM");
  });

  it("overnight 25:30:00 on the fall-back service day is 1:30 AM the next morning", () => {
    // 25:30 on service day Nov 1 (a 25-hour day) is 1:30 AM EST on Nov 2.
    // The midnight-based sum lands at 12:30 AM.
    const { plans } = planAt(nyLocal(2026, 11, 2, 0, 30));
    const night = plans.find((p) => p.segments.some((s) => s.type === "ride" && s.tripId === "night-trip"))!;
    expect(night.departAt).toBe(nyLocal(2026, 11, 2, 1, 30));
    expect(night.arriveAt).toBe(nyLocal(2026, 11, 2, 2, 0));
    expect(night.label).toBe("1:30 AM → 2:00 AM");
  });

  it("overnight 25:30:00 on a normal service day is still 1:30 AM the next morning", () => {
    const { plans } = planAt(nyLocal(2026, 8, 7, 0, 30));
    const night = plans.find((p) => p.segments.some((s) => s.type === "ride" && s.tripId === "night-trip"))!;
    expect(night.departAt).toBe(nyLocal(2026, 8, 7, 1, 30));
    expect(night.label).toBe("1:30 AM → 2:00 AM");
  });
});
