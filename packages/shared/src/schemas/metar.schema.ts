import { z } from "zod";

/**
 * Zod schemas mirroring the METAR types in `types/metar.ts`. Used by the
 * client's `fetchJson` to validate `/api/airspace/metar` responses at the
 * network boundary (#86).
 */

export const FlightCategorySchema = z.enum(["VFR", "MVFR", "IFR", "LIFR"]);

export const MetarWindSchema = z.object({
  directionDeg: z.number().nullable(),
  speedKt: z.number(),
  gustKt: z.number().nullable(),
});

export const MetarReportSchema = z.object({
  icao: z.string(),
  observedAt: z.number(),
  raw: z.string(),
  flightCategory: FlightCategorySchema.nullable(),
  wind: MetarWindSchema.nullable(),
  visibilitySm: z.number().nullable(),
  ceilingFt: z.number().nullable(),
  tempC: z.number().nullable(),
  dewpointC: z.number().nullable(),
  altimeterInHg: z.number().nullable(),
});

export const MetarsResponseSchema = z.object({
  timestamp: z.number(),
  sourceTimestamp: z.number(),
  reports: z.record(z.string(), MetarReportSchema),
  source: z.enum(["live", "cached"]),
});
