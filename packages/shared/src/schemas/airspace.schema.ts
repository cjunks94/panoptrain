import { z } from "zod";

export const AircraftSchema = z.object({
  hex: z.string(),
  callsign: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  altBaro: z.number().nullable(),
  groundSpeed: z.number().nullable(),
  track: z.number().nullable(),
  category: z.string().nullable(),
  squawk: z.string().nullable(),
  seenAt: z.number(),
});

export const AirspaceResponseSchema = z.object({
  timestamp: z.number(),
  sourceTimestamp: z.number(),
  count: z.number(),
  aircraft: z.array(AircraftSchema),
  source: z.enum(["live", "cached"]),
});
