import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GtfsStop, GtfsShape } from "@panoptrain/shared";

const DATA_DIR = join(fileURLToPath(import.meta.url), "../../data/gtfs");

function loadJson<T>(filename: string): T {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${filename}. Run "pnpm download-gtfs" first to download and process static GTFS data.`,
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

let loaded: StaticGtfsData | null = null;

export function loadStaticGtfs(): StaticGtfsData {
  if (loaded) return loaded;

  console.log("Loading static GTFS data...");
  loaded = {
    stops: loadJson("stops.json"),
    routes: loadJson("routes.json"),
    shapes: loadJson("shapes.json"),
    trips: loadJson("trips.json"),
    stopSequences: loadJson("stop_sequences.json"),
    stopDistances: loadJson("stop_distances.json"),
  };
  console.log(
    `  Loaded ${Object.keys(loaded.stops).length} stops, ` +
      `${Object.keys(loaded.shapes).length} shapes, ` +
      `${Object.keys(loaded.trips).length} trips`,
  );
  return loaded;
}
