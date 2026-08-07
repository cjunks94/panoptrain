import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GtfsStop, GtfsShape, Mode } from "@panoptrain/shared";

const BASE_DATA_DIR = join(fileURLToPath(import.meta.url), "../../data");

function dataDirFor(mode: Mode): string {
  // Subway data lives at the original `data/gtfs/` path for back-compat with
  // existing downloads. LIRR (and any future mode) uses `data/gtfs-<mode>/`.
  return mode === "subway" ? join(BASE_DATA_DIR, "gtfs") : join(BASE_DATA_DIR, `gtfs-${mode}`);
}

/** Like `loadJson` but returns `fallback` when the file is absent, for data
 *  files added after existing deployments were built. */
function loadJsonOptional<T>(mode: Mode, filename: string, fallback: T): T {
  const path = join(dataDirFor(mode), filename);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function loadJson<T>(mode: Mode, filename: string): T {
  const path = join(dataDirFor(mode), filename);
  if (!existsSync(path)) {
    const cmd = mode === "subway" ? "pnpm download-gtfs" : `pnpm download-gtfs:${mode}`;
    throw new Error(
      `Missing ${filename} for ${mode}. Run "${cmd}" to download and process static GTFS data.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export interface StaticGtfsData {
  stops: Record<string, GtfsStop>;
  routes: Record<string, { routeId: string; shortName: string; longName: string; color: string; textColor: string }>;
  shapes: Record<string, GtfsShape>;
  trips: Record<
    string,
    {
      tripId: string;
      routeId: string;
      shapeId: string;
      directionId: number;
      tripHeadsign: string;
      /** GTFS service_id — links a trip to its calendar/calendar_dates row.
       *  Optional because the field is only emitted by newer download runs;
       *  pre-existing subway data files predate this column. */
      serviceId?: string;
    }
  >;
  stopSequences: Record<string, { stopId: string; stopSequence: number }[]>;
  stopDistances: Record<string, Record<string, number>>; // shapeId -> stopId -> km
  /** GTFS transfers.txt. Authoritative source for which stations connect —
   *  see `buildStationGraph`. Empty when the data predates #126 or the feed
   *  omits the (optional) file. */
  transfers: GtfsTransfer[];
}

/**
 * GTFS transfers.txt row.
 *
 * Two distinct meanings share the file:
 *  - `fromStopId === toStopId` states the in-station transfer time for a
 *    complex, i.e. how long it takes to change platforms within one parent.
 *  - `fromStopId !== toStopId` is a genuine walkable connection between two
 *    distinct parent stations (Times Sq <-> Port Authority, Cortlandt St <->
 *    Chambers St). The longest in the current subway feed is 435m.
 */
export interface GtfsTransfer {
  fromStopId: string;
  toStopId: string;
  /** GTFS transfer_type. MTA emits 2 ("requires min_transfer_time") for all rows. */
  transferType: number;
  /** Seconds; null for transfer types that don't require a time. */
  minTransferSeconds: number | null;
}

/** GTFS calendar row — defines which days of the week a service runs. */
export interface GtfsCalendarRow {
  serviceId: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  startDate: string; // YYYYMMDD
  endDate: string;
}

/** GTFS calendar_dates row — service additions/removals for specific dates. */
export interface GtfsCalendarDate {
  serviceId: string;
  date: string; // YYYYMMDD
  /** 1 = service added on this date, 2 = service removed. */
  exceptionType: 1 | 2;
}

/** A single stop along a trip, with scheduled arrival/departure times. Times
 *  are raw GTFS strings (HH:MM:SS) — HH may exceed 24 for trips that span
 *  midnight from the prior service date. */
export interface GtfsStopTimeRow {
  stopId: string;
  stopSequence: number;
  arrivalTime: string;
  departureTime: string;
}

/** LIRR-only schedule data, used by the schedule-based trip planner. Subway
 *  uses an adjacency graph so this isn't loaded for it. */
export interface LirrScheduleData {
  /** tripId -> ordered list of stop times along that trip. */
  stopTimes: Record<string, GtfsStopTimeRow[]>;
  calendar: GtfsCalendarRow[];
  calendarDates: GtfsCalendarDate[];
}

const cache: Partial<Record<Mode, StaticGtfsData>> = {};

export function loadStaticGtfs(mode: Mode = "subway"): StaticGtfsData {
  const cached = cache[mode];
  if (cached) return cached;

  console.log(`Loading static GTFS data (${mode})...`);
  const data: StaticGtfsData = {
    stops: loadJson(mode, "stops.json"),
    routes: loadJson(mode, "routes.json"),
    shapes: loadJson(mode, "shapes.json"),
    trips: loadJson(mode, "trips.json"),
    stopSequences: loadJson(mode, "stop_sequences.json"),
    transfers: loadJsonOptional<GtfsTransfer[]>(mode, "transfers.json", []),
    stopDistances: loadJson(mode, "stop_distances.json"),
  };
  console.log(
    `  Loaded ${Object.keys(data.stops).length} stops, ` +
      `${Object.keys(data.shapes).length} shapes, ` +
      `${Object.keys(data.trips).length} trips (${mode})`,
  );
  cache[mode] = data;
  return data;
}

/** Reset cached static data — used by tests so each test sees a clean load. */
export function clearStaticGtfsCache(): void {
  for (const k of Object.keys(cache) as Mode[]) delete cache[k];
  lirrScheduleCache = null;
}

let lirrScheduleCache: LirrScheduleData | null = null;

/**
 * Load LIRR schedule data (stop_times, calendar, calendar_dates). Cached on
 * first load. Throws with a helpful message if the files aren't present —
 * indicates the user needs to re-run `pnpm download-gtfs:lirr` to refresh
 * data with the schedule-aware download script.
 */
export function loadLirrSchedule(): LirrScheduleData {
  if (lirrScheduleCache) return lirrScheduleCache;

  console.log("Loading LIRR schedule data...");
  const data: LirrScheduleData = {
    stopTimes: loadJson("lirr", "stop_times.json"),
    calendar: loadJson("lirr", "calendar.json"),
    calendarDates: loadJson("lirr", "calendar_dates.json"),
  };
  console.log(
    `  Loaded ${Object.keys(data.stopTimes).length} trip schedules, ` +
      `${data.calendar.length} calendar rows, ${data.calendarDates.length} calendar exceptions`,
  );
  lirrScheduleCache = data;
  return data;
}
