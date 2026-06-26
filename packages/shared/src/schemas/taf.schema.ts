import { z } from "zod";

/**
 * Zod schemas mirroring the TAF types in `types/taf.ts`. Used by the
 * client's `fetchJson` to validate `/api/airspace/taf` responses at the
 * network boundary (#86).
 */

export const TafWindSchema = z.object({
  directionDeg: z.number().nullable(),
  speedKt: z.number().nullable(),
  gustKt: z.number().nullable(),
});

export const TafPeriodSchema = z.object({
  timeFrom: z.number(),
  timeTo: z.number(),
  fcstChange: z.enum(["FM", "TEMPO", "BECMG", "PROB"]).nullable(),
  probability: z.number().nullable(),
  wind: TafWindSchema.nullable(),
  visibilitySm: z.number().nullable(),
  ceilingFt: z.number().nullable(),
  wxString: z.string().nullable(),
});

export const TafReportSchema = z.object({
  icao: z.string(),
  issuedAt: z.number(),
  validFrom: z.number(),
  validTo: z.number(),
  raw: z.string(),
  forecasts: z.array(TafPeriodSchema),
});

export const TafsResponseSchema = z.object({
  timestamp: z.number(),
  sourceTimestamp: z.number(),
  reports: z.record(z.string(), TafReportSchema),
  source: z.enum(["live", "cached"]),
});
