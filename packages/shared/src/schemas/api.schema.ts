import { z } from "zod";

export const TrainPositionSchema = z.object({
  tripId: z.string(),
  routeId: z.string(),
  direction: z.union([z.literal(0), z.literal(1)]),
  latitude: z.number(),
  longitude: z.number(),
  bearing: z.number().nullable(),
  status: z.enum(["STOPPED_AT", "INCOMING_AT", "IN_TRANSIT_TO"]),
  currentStopId: z.string(),
  currentStopName: z.string(),
  nextStopId: z.string().nullable(),
  nextStopName: z.string().nullable(),
  destination: z.string(),
  delay: z.number().nullable(),
  updatedAt: z.number(),
});

export const TrainsResponseSchema = z.object({
  timestamp: z.number(),
  count: z.number(),
  trains: z.array(TrainPositionSchema),
});
