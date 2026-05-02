/**
 * Downloads MTA static GTFS data (subway by default, or LIRR with `lirr` arg)
 * and processes it into optimized JSON files.
 *
 * Usage:
 *   pnpm download-gtfs        # subway → packages/server/src/data/gtfs/
 *   pnpm download-gtfs lirr   # LIRR   → packages/server/src/data/gtfs-lirr/
 *
 * Outputs (per mode):
 *   - stops.json: station locations indexed by stop_id
 *   - routes.json: route metadata
 *   - shapes.json: route polylines as GeoJSON-compatible coordinate arrays
 *   - trips.json: trip -> route/shape/direction (+ serviceId)
 *   - stop_distances.json: pre-computed distance of each stop along its route shape
 *
 * LIRR-only (used by the schedule-based trip planner — subway uses an
 * adjacency graph and doesn't need timetable data):
 *   - stop_times.json: per-trip ordered stops with arrival/departure times
 *   - calendar.json: service-day patterns (which days of the week run)
 *   - calendar_dates.json: service-day exceptions (holidays, special days)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { parse } from "csv-parse/sync";
import JSZip from "jszip";
import { staticGtfsUrlForMode } from "@panoptrain/shared";
import type { Mode } from "@panoptrain/shared";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";

const modeArg = process.argv[2];
const MODE: Mode = modeArg === "lirr" ? "lirr" : "subway";
const SUBDIR = MODE === "subway" ? "gtfs" : `gtfs-${MODE}`;
const OUT_DIR = new URL(`../src/data/${SUBDIR}/`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const SOURCE_URL = staticGtfsUrlForMode(MODE);

interface RawStop {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type: string;
  parent_station: string;
}

interface RawRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_color: string;
  route_text_color: string;
}

interface RawShape {
  shape_id: string;
  shape_pt_lat: string;
  shape_pt_lon: string;
  shape_pt_sequence: string;
}

interface RawTrip {
  trip_id: string;
  route_id: string;
  shape_id: string;
  direction_id: string;
  trip_headsign: string;
  service_id: string;
}

interface RawStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
  arrival_time: string;
  departure_time: string;
}

interface RawCalendar {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  start_date: string; // YYYYMMDD
  end_date: string;
}

interface RawCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: string; // "1" = added, "2" = removed
}

async function main() {
  console.log(`Downloading ${MODE} GTFS static data from ${SOURCE_URL}...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  const buf = await res.arrayBuffer();

  console.log("Extracting zip...");
  const zip = await JSZip.loadAsync(buf);

  const readCsv = async <T>(name: string): Promise<T[]> => {
    const file = zip.file(name);
    if (!file) throw new Error(`Missing ${name} in GTFS zip`);
    const text = await file.async("text");
    return parse(text, { columns: true, skip_empty_lines: true }) as T[];
  };

  // Optional CSVs may be absent in some GTFS feeds (e.g. calendar.txt is
  // omitted when all services are expressed as calendar_dates exceptions).
  const readCsvOptional = async <T>(name: string): Promise<T[]> => {
    const file = zip.file(name);
    if (!file) return [];
    const text = await file.async("text");
    return parse(text, { columns: true, skip_empty_lines: true }) as T[];
  };

  // Parse all CSVs in parallel
  const [rawStops, rawRoutes, rawShapes, rawTrips, rawStopTimes, rawCalendar, rawCalendarDates] =
    await Promise.all([
      readCsv<RawStop>("stops.txt"),
      readCsv<RawRoute>("routes.txt"),
      readCsv<RawShape>("shapes.txt"),
      readCsv<RawTrip>("trips.txt"),
      readCsv<RawStopTime>("stop_times.txt"),
      readCsvOptional<RawCalendar>("calendar.txt"),
      readCsvOptional<RawCalendarDate>("calendar_dates.txt"),
    ]);

  console.log(
    `Parsed: ${rawStops.length} stops, ${rawRoutes.length} routes, ` +
      `${rawShapes.length} shape points, ${rawTrips.length} trips, ${rawStopTimes.length} stop times, ` +
      `${rawCalendar.length} calendar rows, ${rawCalendarDates.length} calendar exceptions`,
  );

  // Process stops — only keep stations (location_type=1 or parent stations)
  const stops: Record<string, { stopId: string; stopName: string; lat: number; lon: number; parentStation: string | null }> = {};
  for (const s of rawStops) {
    stops[s.stop_id] = {
      stopId: s.stop_id,
      stopName: s.stop_name,
      lat: parseFloat(s.stop_lat),
      lon: parseFloat(s.stop_lon),
      parentStation: s.parent_station || null,
    };
  }

  // Process routes
  const routes: Record<string, { routeId: string; shortName: string; longName: string; color: string; textColor: string }> = {};
  for (const r of rawRoutes) {
    routes[r.route_id] = {
      routeId: r.route_id,
      shortName: r.route_short_name,
      longName: r.route_long_name,
      color: r.route_color ? `#${r.route_color}` : "#808183",
      textColor: r.route_text_color ? `#${r.route_text_color}` : "#FFFFFF",
    };
  }

  // Process shapes — group by shape_id, sort by sequence, output as [lon, lat] coordinates
  const shapePoints = new Map<string, { seq: number; lon: number; lat: number }[]>();
  for (const s of rawShapes) {
    const id = s.shape_id;
    if (!shapePoints.has(id)) shapePoints.set(id, []);
    shapePoints.get(id)!.push({
      seq: parseInt(s.shape_pt_sequence, 10),
      lon: parseFloat(s.shape_pt_lon),
      lat: parseFloat(s.shape_pt_lat),
    });
  }

  const shapes: Record<string, { shapeId: string; coordinates: [number, number][] }> = {};
  for (const [id, pts] of shapePoints) {
    pts.sort((a, b) => a.seq - b.seq);
    shapes[id] = {
      shapeId: id,
      coordinates: pts.map((p) => [p.lon, p.lat]),
    };
  }

  // Process trips — deduplicate by keeping one representative trip per route+direction+shape
  const trips: Record<
    string,
    {
      tripId: string;
      routeId: string;
      shapeId: string;
      directionId: number;
      tripHeadsign: string;
      serviceId: string;
    }
  > = {};
  const tripPatterns = new Map<string, string>(); // pattern key -> tripId (for stop_times lookup)
  for (const t of rawTrips) {
    trips[t.trip_id] = {
      tripId: t.trip_id,
      routeId: t.route_id,
      shapeId: t.shape_id,
      directionId: parseInt(t.direction_id, 10),
      tripHeadsign: t.trip_headsign,
      serviceId: t.service_id,
    };
    const patternKey = `${t.route_id}-${t.direction_id}-${t.shape_id}`;
    if (!tripPatterns.has(patternKey)) {
      tripPatterns.set(patternKey, t.trip_id);
    }
  }

  // Build stop sequence patterns: for each representative trip, get the ordered list of stops
  // This lets us know which stops a train passes through for a given route+direction+shape
  const stopSequences: Record<string, { stopId: string; stopSequence: number }[]> = {};
  const stopTimesByTrip = new Map<string, RawStopTime[]>();
  for (const st of rawStopTimes) {
    if (!stopTimesByTrip.has(st.trip_id)) stopTimesByTrip.set(st.trip_id, []);
    stopTimesByTrip.get(st.trip_id)!.push(st);
  }

  for (const [patternKey, tripId] of tripPatterns) {
    const times = stopTimesByTrip.get(tripId);
    if (!times) continue;
    times.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    stopSequences[patternKey] = times.map((t) => ({
      stopId: t.stop_id,
      stopSequence: parseInt(t.stop_sequence, 10),
    }));
  }

  // Pre-compute stop distances along each shape
  console.log("Computing stop distances along route shapes...");
  const stopDistances: Record<string, Record<string, number>> = {}; // shapeId -> stopId -> distance (km)

  for (const [shapeId, shape] of Object.entries(shapes)) {
    if (shape.coordinates.length < 2) continue;
    const line = lineString(shape.coordinates);
    stopDistances[shapeId] = {};

    // Find all stops that are used on this shape (from stop sequences)
    const stopsOnThisShape = new Set<string>();
    for (const [patternKey, seq] of Object.entries(stopSequences)) {
      const trip = trips[tripPatterns.get(patternKey)!];
      if (trip?.shapeId === shapeId) {
        for (const s of seq) stopsOnThisShape.add(s.stopId);
      }
    }

    for (const stopId of stopsOnThisShape) {
      const stop = stops[stopId];
      if (!stop) continue;
      const pt = point([stop.lon, stop.lat]);
      const nearest = nearestPointOnLine(line, pt);
      const dist = nearest.properties.location;
      if (dist !== undefined) {
        stopDistances[shapeId][stopId] = Math.round(dist * 10000) / 10000; // 4 decimal places (~0.1m precision)
      }
    }
  }

  // Write output files
  mkdirSync(OUT_DIR, { recursive: true });

  const write = (name: string, data: unknown) => {
    const path = `${OUT_DIR}/${name}`;
    writeFileSync(path, JSON.stringify(data));
    console.log(`  Wrote ${path}`);
  };

  write("stops.json", stops);
  write("routes.json", routes);
  write("shapes.json", shapes);
  write("trips.json", trips);
  write("stop_sequences.json", stopSequences);
  write("stop_distances.json", stopDistances);

  // Schedule + calendar — LIRR only. The subway planner is graph-based and
  // doesn't consume timetables; emitting them for subway would inflate the
  // bundle by tens of MB without benefit. Re-evaluate if subway ever moves
  // to a schedule-aware planner.
  if (MODE === "lirr") {
    // stop_times.json: per trip, ordered list of stops with arrival/departure
    // times. Times are kept as raw HH:MM:SS strings (may exceed 24h, e.g.
    // "25:30:00" for trips that depart on the prior service date and run
    // past midnight). The planner parses these into NY-tz timestamps using
    // the relevant service date.
    const stopTimesByTripOut: Record<
      string,
      { stopId: string; stopSequence: number; arrivalTime: string; departureTime: string }[]
    > = {};
    for (const [tripId, times] of stopTimesByTrip) {
      const sorted = [...times].sort(
        (a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10),
      );
      stopTimesByTripOut[tripId] = sorted.map((t) => ({
        stopId: t.stop_id,
        stopSequence: parseInt(t.stop_sequence, 10),
        arrivalTime: t.arrival_time,
        departureTime: t.departure_time,
      }));
    }
    write("stop_times.json", stopTimesByTripOut);

    const calendar = rawCalendar.map((c) => ({
      serviceId: c.service_id,
      monday: c.monday === "1",
      tuesday: c.tuesday === "1",
      wednesday: c.wednesday === "1",
      thursday: c.thursday === "1",
      friday: c.friday === "1",
      saturday: c.saturday === "1",
      sunday: c.sunday === "1",
      startDate: c.start_date, // YYYYMMDD
      endDate: c.end_date,
    }));
    write("calendar.json", calendar);

    const calendarDates = rawCalendarDates.map((d) => ({
      serviceId: d.service_id,
      date: d.date,
      exceptionType: parseInt(d.exception_type, 10) as 1 | 2,
    }));
    write("calendar_dates.json", calendarDates);
  }

  console.log("Done! Static GTFS data processed successfully.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
