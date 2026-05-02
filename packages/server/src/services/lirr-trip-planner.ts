import type {
  LirrTripPlan,
  LirrRideSegment,
  LirrTransferSegment,
} from "@panoptrain/shared";
import type { StaticGtfsData, LirrScheduleData } from "./gtfs-loader.js";

const TRANSFER_BUFFER_MIN = 5;
const MAX_PLANS = 3;
/**
 * How far ahead of the requested departure to search for trips. Direct trips
 * use a wider window because we're only doing one cheap lookup per origin
 * stop. Transfer expansion uses a tighter window since work is multiplied by
 * the number of intermediate stops.
 */
const DIRECT_LOOKAHEAD_HOURS = 6;
const TRANSFER_LOOKAHEAD_HOURS = 4;

interface StopDeparture {
  tripId: string;
  stopSequence: number;
  /** Seconds after service-date midnight (HH may be ≥ 24 for trips that
   *  cross midnight from the prior service date). */
  departureTimeSec: number;
  arrivalTimeSec: number;
}

interface ScheduleIndex {
  /** stopId -> sorted (asc by departureTimeSec) list of departures. */
  stopDepartures: Map<string, StopDeparture[]>;
  /** date YYYYMMDD -> serviceId -> exceptionType (1=add, 2=remove). */
  calendarDatesByDate: Map<string, Map<string, 1 | 2>>;
}

let cachedIndex: ScheduleIndex | null = null;
const cachedActiveServices = new Map<string, Set<string>>();

/** Reset cached index — used by tests. */
export function clearLirrPlannerCache(): void {
  cachedIndex = null;
  cachedActiveServices.clear();
  midnightCache.clear();
}

function buildIndex(schedule: LirrScheduleData): ScheduleIndex {
  const stopDepartures = new Map<string, StopDeparture[]>();
  for (const [tripId, stops] of Object.entries(schedule.stopTimes)) {
    for (const st of stops) {
      const dep = parseGtfsTime(st.departureTime);
      const arr = parseGtfsTime(st.arrivalTime);
      let list = stopDepartures.get(st.stopId);
      if (!list) {
        list = [];
        stopDepartures.set(st.stopId, list);
      }
      list.push({
        tripId,
        stopSequence: st.stopSequence,
        departureTimeSec: dep,
        arrivalTimeSec: arr,
      });
    }
  }
  for (const arr of stopDepartures.values()) {
    arr.sort((a, b) => a.departureTimeSec - b.departureTimeSec);
  }

  const calendarDatesByDate = new Map<string, Map<string, 1 | 2>>();
  for (const ex of schedule.calendarDates) {
    let inner = calendarDatesByDate.get(ex.date);
    if (!inner) {
      inner = new Map();
      calendarDatesByDate.set(ex.date, inner);
    }
    inner.set(ex.serviceId, ex.exceptionType);
  }

  return { stopDepartures, calendarDatesByDate };
}

function getIndex(schedule: LirrScheduleData): ScheduleIndex {
  if (!cachedIndex) cachedIndex = buildIndex(schedule);
  return cachedIndex;
}

/** Parse "HH:MM:SS" (HH may exceed 23) into seconds-since-midnight. */
function parseGtfsTime(s: string): number {
  const [h, m, ss] = s.split(":");
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(ss, 10);
}

const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Day-of-week (0=Sunday) for a YYYYMMDD date string. */
function weekdayOf(yyyymmdd: string): typeof WEEKDAY_KEYS[number] {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  // UTC midnight is fine here — we only need the calendar day-of-week, which
  // matches across all timezones for a given calendar date.
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Set of serviceIds active on a given NY calendar date. */
function activeServicesOn(
  yyyymmdd: string,
  schedule: LirrScheduleData,
  index: ScheduleIndex,
): Set<string> {
  const cached = cachedActiveServices.get(yyyymmdd);
  if (cached) return cached;

  const result = new Set<string>();
  const weekday = weekdayOf(yyyymmdd);

  // calendar.txt — base service-day patterns. LIRR omits this file (all
  // service is encoded in calendar_dates), but keep the logic for robustness.
  for (const c of schedule.calendar) {
    if (yyyymmdd < c.startDate || yyyymmdd > c.endDate) continue;
    if (c[weekday]) result.add(c.serviceId);
  }

  // calendar_dates exceptions.
  const exceptions = index.calendarDatesByDate.get(yyyymmdd);
  if (exceptions) {
    for (const [serviceId, exType] of exceptions) {
      if (exType === 1) result.add(serviceId);
      else result.delete(serviceId);
    }
  }

  cachedActiveServices.set(yyyymmdd, result);
  return result;
}

/** Format a NY-tz local instant as "YYYYMMDD". */
function nyDateString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(epochMs);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}${m}${d}`;
}

/**
 * Cache of (NY service date YYYYMMDD) → epoch ms at NY-local midnight.
 *
 * Computing the offset via Intl.DateTimeFormat is expensive (~1-2ms per call
 * on Node) and dominates planner runtime when called per stop_time. Caching
 * once per service date drops planning latency from multi-second to <100ms.
 */
const midnightCache = new Map<string, number>();

/** Compute epoch ms at NY-local midnight on a YYYYMMDD date. Iterates twice
 *  to converge through any DST boundary; midnight is unambiguous in NY. */
function nyMidnightMs(yyyymmdd: string): number {
  const cached = midnightCache.get(yyyymmdd);
  if (cached !== undefined) return cached;
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  let ms = Date.UTC(y, m - 1, d, 0, 0, 0);
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
    const yy = parseInt(parts.find((p) => p.type === "year")!.value, 10);
    const mm = parseInt(parts.find((p) => p.type === "month")!.value, 10);
    const dd = parseInt(parts.find((p) => p.type === "day")!.value, 10);
    const hh = parseInt(parts.find((p) => p.type === "hour")!.value, 10) % 24;
    const mn = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
    const got = Date.UTC(yy, mm - 1, dd, hh, mn, 0);
    const want = Date.UTC(y, m - 1, d, 0, 0, 0);
    ms += want - got;
  }
  midnightCache.set(yyyymmdd, ms);
  return ms;
}

/** Convert a (NY service date, seconds-after-midnight) to epoch ms. Hot path —
 *  add to the cached midnight, no Intl calls after the first per date. */
function nyWallToEpoch(yyyymmdd: string, secondsAfterMidnight: number): number {
  return nyMidnightMs(yyyymmdd) + secondsAfterMidnight * 1000;
}

interface DepartureCandidate {
  tripId: string;
  serviceDate: string;
  /** Departure at the boarding stop, epoch ms. */
  departAt: number;
  /** Stop sequence at the boarding stop. */
  fromSequence: number;
}

/**
 * Find candidate trips departing any of `fromStops` after `departAfterMs`,
 * within the look-ahead window. Considers two service dates (yesterday +
 * today in NY tz) so trips encoded with 24+h times on the prior service
 * date are still surfaced.
 */
function findDepartures(
  fromStops: ReadonlySet<string>,
  departAfterMs: number,
  windowHours: number,
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
  index: ScheduleIndex,
): DepartureCandidate[] {
  const cutoffMs = departAfterMs + windowHours * 3600 * 1000;
  const candidates: DepartureCandidate[] = [];
  const seenTripBoarding = new Set<string>(); // dedupe (tripId, serviceDate, fromStop)

  // Two service dates: yesterday + today in NY. A trip on yesterday's service
  // with departure time 25:30 means 1:30 AM today.
  const todayDate = nyDateString(departAfterMs);
  const yesterdayDate = nyDateString(departAfterMs - 24 * 3600 * 1000);
  const dates = yesterdayDate === todayDate ? [todayDate] : [yesterdayDate, todayDate];

  for (const serviceDate of dates) {
    const activeServices = activeServicesOn(serviceDate, schedule, index);
    if (activeServices.size === 0) continue;

    for (const fromStop of fromStops) {
      const departures = index.stopDepartures.get(fromStop);
      if (!departures) continue;

      for (const dep of departures) {
        const trip = gtfs.trips[dep.tripId];
        if (!trip || !trip.serviceId) continue;
        if (!activeServices.has(trip.serviceId)) continue;

        const epochMs = nyWallToEpoch(serviceDate, dep.departureTimeSec);
        if (epochMs < departAfterMs) continue;
        if (epochMs > cutoffMs) break; // departures sorted; no point continuing

        const dedupeKey = `${dep.tripId}|${serviceDate}|${fromStop}`;
        if (seenTripBoarding.has(dedupeKey)) continue;
        seenTripBoarding.add(dedupeKey);

        candidates.push({
          tripId: dep.tripId,
          serviceDate,
          departAt: epochMs,
          fromSequence: dep.stopSequence,
        });
      }
    }
  }

  return candidates;
}

interface DirectTrip {
  tripId: string;
  serviceDate: string;
  departAt: number;
  arriveAt: number;
  fromSequence: number;
  toSequence: number;
}

/** Find direct trips: candidate departures whose trip later stops at toStops. */
function findDirectTrips(
  candidates: DepartureCandidate[],
  toStops: ReadonlySet<string>,
  schedule: LirrScheduleData,
): DirectTrip[] {
  const direct: DirectTrip[] = [];
  for (const c of candidates) {
    const tripStops = schedule.stopTimes[c.tripId];
    if (!tripStops) continue;
    // Walk from the boarding sequence onwards looking for any toStop.
    for (const st of tripStops) {
      if (st.stopSequence <= c.fromSequence) continue;
      if (toStops.has(st.stopId)) {
        direct.push({
          tripId: c.tripId,
          serviceDate: c.serviceDate,
          departAt: c.departAt,
          arriveAt: nyWallToEpoch(c.serviceDate, parseGtfsTime(st.arrivalTime)),
          fromSequence: c.fromSequence,
          toSequence: st.stopSequence,
        });
        break;
      }
    }
  }
  return direct;
}

interface OneTransferTrip {
  legA: { tripId: string; serviceDate: string; fromSeq: number; toSeq: number; departAt: number; arriveAt: number };
  legB: { tripId: string; serviceDate: string; fromSeq: number; toSeq: number; departAt: number; arriveAt: number };
  transferStopId: string;
  transferMinutes: number;
}

/**
 * Find one-transfer trips: for each candidate trip A, walk its later stops
 * and look for trips B departing that stop after a buffer that reach toStops.
 */
function findOneTransferTrips(
  candidates: DepartureCandidate[],
  toStops: ReadonlySet<string>,
  fromStops: ReadonlySet<string>,
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
  index: ScheduleIndex,
): OneTransferTrip[] {
  const transfers: OneTransferTrip[] = [];
  const transferBufferMs = TRANSFER_BUFFER_MIN * 60 * 1000;
  const transferCutoffMs = TRANSFER_LOOKAHEAD_HOURS * 3600 * 1000;
  const seen = new Set<string>(); // dedupe

  for (const c of candidates) {
    const tripStops = schedule.stopTimes[c.tripId];
    if (!tripStops) continue;

    for (const st of tripStops) {
      if (st.stopSequence <= c.fromSequence) continue;
      if (fromStops.has(st.stopId)) continue; // can't transfer back at origin
      if (toStops.has(st.stopId)) break; // direct trip is better — handled separately

      const transferArriveMs = nyWallToEpoch(c.serviceDate, parseGtfsTime(st.arrivalTime));
      const transferReadyMs = transferArriveMs + transferBufferMs;

      // Find trips departing st.stopId after transferReadyMs that reach toStops.
      const onwardCandidates = findDepartures(
        new Set([st.stopId]),
        transferReadyMs,
        TRANSFER_LOOKAHEAD_HOURS,
        gtfs,
        schedule,
        index,
      );

      for (const onward of onwardCandidates) {
        if (onward.tripId === c.tripId) continue; // same trip — not a real transfer
        if (onward.departAt - transferArriveMs > transferCutoffMs) break;

        const onwardStops = schedule.stopTimes[onward.tripId];
        if (!onwardStops) continue;
        let foundAlight: { stopId: string; arriveAt: number; sequence: number } | null = null;
        for (const ost of onwardStops) {
          if (ost.stopSequence <= onward.fromSequence) continue;
          if (toStops.has(ost.stopId)) {
            foundAlight = {
              stopId: ost.stopId,
              arriveAt: nyWallToEpoch(onward.serviceDate, parseGtfsTime(ost.arrivalTime)),
              sequence: ost.stopSequence,
            };
            break;
          }
        }
        if (!foundAlight) continue;

        const dedupeKey = `${c.tripId}|${onward.tripId}|${st.stopId}|${c.serviceDate}|${onward.serviceDate}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        transfers.push({
          legA: {
            tripId: c.tripId,
            serviceDate: c.serviceDate,
            fromSeq: c.fromSequence,
            toSeq: st.stopSequence,
            departAt: c.departAt,
            arriveAt: transferArriveMs,
          },
          legB: {
            tripId: onward.tripId,
            serviceDate: onward.serviceDate,
            fromSeq: onward.fromSequence,
            toSeq: foundAlight.sequence,
            departAt: onward.departAt,
            arriveAt: foundAlight.arriveAt,
          },
          transferStopId: st.stopId,
          transferMinutes: Math.round((onward.departAt - transferArriveMs) / 60000),
        });

        // One onward connection per transfer point is enough — the next
        // onward train just produces a strictly later itinerary using the
        // same legs A/B-stop combo, which is rarely useful.
        break;
      }
    }
  }

  return transfers;
}

/** Convert a direct trip into a TripPlan. */
function buildDirectPlan(
  direct: DirectTrip,
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
  fromName: string,
  toName: string,
): LirrTripPlan {
  const ride = buildRideSegment(direct, gtfs, schedule);

  return {
    label: formatTimeRange(direct.departAt, direct.arriveAt),
    from: { stopId: ride.boardAt.stopId, stopName: fromName },
    to: { stopId: ride.alightAt.stopId, stopName: toName },
    departAt: direct.departAt,
    arriveAt: direct.arriveAt,
    totalMinutes: Math.round((direct.arriveAt - direct.departAt) / 60000),
    transferCount: 0,
    segments: [ride],
  };
}

/** Convert a one-transfer trip into a TripPlan. */
function buildTransferPlan(
  t: OneTransferTrip,
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
  fromName: string,
  toName: string,
): LirrTripPlan {
  const rideA = buildRideSegment(
    {
      tripId: t.legA.tripId,
      serviceDate: t.legA.serviceDate,
      departAt: t.legA.departAt,
      arriveAt: t.legA.arriveAt,
      fromSequence: t.legA.fromSeq,
      toSequence: t.legA.toSeq,
    },
    gtfs,
    schedule,
  );
  const transferStopName = gtfs.stops[t.transferStopId]?.stopName ?? t.transferStopId;
  const transfer: LirrTransferSegment = {
    type: "transfer",
    atStopId: t.transferStopId,
    atStopName: transferStopName,
    minutes: t.transferMinutes,
  };
  const rideB = buildRideSegment(
    {
      tripId: t.legB.tripId,
      serviceDate: t.legB.serviceDate,
      departAt: t.legB.departAt,
      arriveAt: t.legB.arriveAt,
      fromSequence: t.legB.fromSeq,
      toSequence: t.legB.toSeq,
    },
    gtfs,
    schedule,
  );

  return {
    label: formatTimeRange(t.legA.departAt, t.legB.arriveAt),
    from: { stopId: rideA.boardAt.stopId, stopName: fromName },
    to: { stopId: rideB.alightAt.stopId, stopName: toName },
    departAt: t.legA.departAt,
    arriveAt: t.legB.arriveAt,
    totalMinutes: Math.round((t.legB.arriveAt - t.legA.departAt) / 60000),
    transferCount: 1,
    segments: [rideA, transfer, rideB],
  };
}

interface RideInput {
  tripId: string;
  serviceDate: string;
  departAt: number;
  arriveAt: number;
  fromSequence: number;
  toSequence: number;
}

function buildRideSegment(
  ride: RideInput,
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
): LirrRideSegment {
  const trip = gtfs.trips[ride.tripId];
  const tripStops = schedule.stopTimes[ride.tripId] ?? [];
  const stopsInRange = tripStops.filter(
    (st) => st.stopSequence >= ride.fromSequence && st.stopSequence <= ride.toSequence,
  );

  const boardStop = stopsInRange[0];
  const alightStop = stopsInRange[stopsInRange.length - 1];
  const stopsOut = stopsInRange.map((st) => ({
    stopId: st.stopId,
    stopName: gtfs.stops[st.stopId]?.stopName ?? st.stopId,
    arriveAt: nyWallToEpoch(ride.serviceDate, parseGtfsTime(st.arrivalTime)),
  }));

  return {
    type: "ride",
    routeId: trip?.routeId ?? "",
    tripId: ride.tripId,
    tripHeadsign: trip?.tripHeadsign ?? "",
    boardAt: {
      stopId: boardStop?.stopId ?? "",
      stopName: gtfs.stops[boardStop?.stopId ?? ""]?.stopName ?? "",
    },
    alightAt: {
      stopId: alightStop?.stopId ?? "",
      stopName: gtfs.stops[alightStop?.stopId ?? ""]?.stopName ?? "",
    },
    stops: stopsOut,
    departAt: ride.departAt,
    arriveAt: ride.arriveAt,
    path: extractShapePath(gtfs, trip?.shapeId ?? "", stopsOut.map((s) => s.stopId)),
  };
}

function formatTimeRange(departMs: number, arriveMs: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${fmt.format(departMs)} → ${fmt.format(arriveMs)}`;
}

/** Extract shape coordinates between the first and last stops, mirroring the
 *  approach used by the subway planner. */
function extractShapePath(
  gtfs: StaticGtfsData,
  shapeId: string,
  stopIds: string[],
): [number, number][] {
  if (!shapeId || stopIds.length < 2) {
    return stopIds
      .map((id) => gtfs.stops[id])
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => [s.lon, s.lat] as [number, number]);
  }
  const shape = gtfs.shapes[shapeId];
  const dists = gtfs.stopDistances[shapeId];
  if (!shape || !dists) {
    return stopIds
      .map((id) => gtfs.stops[id])
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => [s.lon, s.lat] as [number, number]);
  }
  const firstDist = dists[stopIds[0]];
  const lastDist = dists[stopIds[stopIds.length - 1]];
  if (firstDist === undefined || lastDist === undefined) {
    return stopIds
      .map((id) => gtfs.stops[id])
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => [s.lon, s.lat] as [number, number]);
  }
  const minDist = Math.min(firstDist, lastDist);
  const maxDist = Math.max(firstDist, lastDist);
  const coords: [number, number][] = [];
  let cumDist = 0;
  for (let j = 0; j < shape.coordinates.length; j++) {
    if (j > 0) {
      cumDist += geoDistKm(shape.coordinates[j - 1], shape.coordinates[j]);
    }
    if (cumDist >= minDist && cumDist <= maxDist + 0.01) {
      coords.push(shape.coordinates[j]);
    }
    if (cumDist > maxDist + 0.5) break;
  }
  if (coords.length >= 2) return coords;
  return stopIds
    .map((id) => gtfs.stops[id])
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => [s.lon, s.lat] as [number, number]);
}

function geoDistKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLon = (lon2 - lon1) * Math.cos(meanLat);
  return Math.sqrt(dLat * dLat + dLon * dLon) * 111.32;
}

export interface LirrPlannerResult {
  plans: LirrTripPlan[];
  serviceDate: string;
}

/**
 * Plan LIRR trips from `fromIds` to `toIds`, departing at or after `departAt`.
 * Returns up to 3 itineraries ranked by arrival time then transfer count.
 */
export function planLirrTrips(
  gtfs: StaticGtfsData,
  schedule: LirrScheduleData,
  fromIds: string[],
  toIds: string[],
  departAt: number,
): LirrPlannerResult {
  const fromStops = new Set(fromIds.filter((id) => gtfs.stops[id]));
  const toStops = new Set(toIds.filter((id) => gtfs.stops[id]));
  const serviceDate = nyDateString(departAt);

  if (fromStops.size === 0 || toStops.size === 0) {
    return { plans: [], serviceDate };
  }
  // Reject if from/to overlap.
  for (const s of fromStops) if (toStops.has(s)) return { plans: [], serviceDate };

  const index = getIndex(schedule);
  const fromName = gtfs.stops[Array.from(fromStops)[0]]?.stopName ?? "";
  const toName = gtfs.stops[Array.from(toStops)[0]]?.stopName ?? "";

  // Direct trips
  const directCandidates = findDepartures(
    fromStops,
    departAt,
    DIRECT_LOOKAHEAD_HOURS,
    gtfs,
    schedule,
    index,
  );
  const directs = findDirectTrips(directCandidates, toStops, schedule);

  // One-transfer trips — only search if we don't have enough directs already
  // OR if the directs require a long wait, since a transferred itinerary
  // departing sooner could still arrive earlier.
  const transferCandidates = findDepartures(
    fromStops,
    departAt,
    TRANSFER_LOOKAHEAD_HOURS,
    gtfs,
    schedule,
    index,
  );
  const transfers = findOneTransferTrips(
    transferCandidates,
    toStops,
    fromStops,
    gtfs,
    schedule,
    index,
  );

  const plans: LirrTripPlan[] = [
    ...directs.map((d) => buildDirectPlan(d, gtfs, schedule, fromName, toName)),
    ...transfers.map((t) => buildTransferPlan(t, gtfs, schedule, fromName, toName)),
  ];

  // Sort by arrival time, then by transfer count (prefer fewer transfers
  // when arrivals tie).
  plans.sort((a, b) => a.arriveAt - b.arriveAt || a.transferCount - b.transferCount);

  // Dedupe: drop any plan whose departAt+arriveAt match an earlier one (rare
  // but happens when a stop has multiple platform IDs that share a schedule).
  const seen = new Set<string>();
  const deduped: LirrTripPlan[] = [];
  for (const p of plans) {
    const key = `${p.departAt}|${p.arriveAt}|${p.transferCount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
    if (deduped.length >= MAX_PLANS) break;
  }

  return { plans: deduped, serviceDate };
}
