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

function loadJson<T>(mode: Mode, filename: string): T {
  const path = join(dataDirFor(mode), filename);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${filename} for ${mode}. Run "pnpm download-gtfs ${mode === "subway" ? "" : mode}" to download and process static GTFS data.`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export interface StaticGtfsData {
  stops: Record<string, GtfsStop>;
  routes: Record<string, { routeId: string; shortName: string; longName: string; color: string; textColor: string }>;
  shapes: Record<string, GtfsShape>;
  trips: Record<string, { tripId: string; routeId: string; shapeId: string; directionId: number; tripHeadsign: string }>;
  stopSequences: Record<string, { stopId: string; stopSequence: number }[]>;
  stopDistances: Record<string, Record<string, number>>; // shapeId -> stopId -> km
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
}
