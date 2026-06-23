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
  lastObservedAt: z.number().nullable(),
});

export const TrainsResponseSchema = z.object({
  timestamp: z.number(),
  count: z.number(),
  trains: z.array(TrainPositionSchema),
  previous: z
    .object({
      timestamp: z.number(),
      trains: z.array(TrainPositionSchema),
    })
    .optional(),
});

/** [lng, lat] GeoJSON convention. */
const CoordinateSchema = z.tuple([z.number(), z.number()]);

export const RouteFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    routeId: z.string(),
    color: z.string(),
    name: z.string(),
  }),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(CoordinateSchema),
  }),
});

export const RoutesGeoJSONSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(RouteFeatureSchema),
});

export const StopFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    stopId: z.string(),
    stopName: z.string(),
    routes: z.array(z.string()).optional(),
    importance: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  }),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: CoordinateSchema,
  }),
});

export const StopsGeoJSONSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(StopFeatureSchema),
});

const StopRefSchema = z.object({
  stopId: z.string(),
  stopName: z.string(),
});

export const DelayInfoSchema = z.object({
  minSeconds: z.number(),
  maxSeconds: z.number(),
  trainsObserved: z.number(),
});

export const RideSegmentSchema = z.object({
  type: z.literal("ride"),
  routeId: z.string(),
  boardAt: StopRefSchema,
  alightAt: StopRefSchema,
  stops: z.array(StopRefSchema),
  path: z.array(CoordinateSchema),
  intermediateStops: z.number(),
  minutes: z.number(),
  delay: DelayInfoSchema.nullable(),
});

export const TransferSegmentSchema = z.object({
  type: z.literal("transfer"),
  atStopName: z.string(),
  minutes: z.number(),
});

export const TripPlanSchema = z.object({
  label: z.string(),
  from: StopRefSchema,
  to: StopRefSchema,
  totalMinutes: z.number(),
  totalStops: z.number(),
  transferCount: z.number(),
  segments: z.array(z.discriminatedUnion("type", [RideSegmentSchema, TransferSegmentSchema])),
});

export const PlanResponseSchema = z.object({
  plans: z.array(TripPlanSchema),
});

const LirrStopWithArrivalSchema = z.object({
  stopId: z.string(),
  stopName: z.string(),
  arriveAt: z.number(),
});

export const LirrRideSegmentSchema = z.object({
  type: z.literal("ride"),
  routeId: z.string(),
  tripId: z.string(),
  tripHeadsign: z.string(),
  boardAt: StopRefSchema,
  alightAt: StopRefSchema,
  stops: z.array(LirrStopWithArrivalSchema),
  departAt: z.number(),
  arriveAt: z.number(),
  path: z.array(CoordinateSchema),
});

export const LirrTransferSegmentSchema = z.object({
  type: z.literal("transfer"),
  atStopId: z.string(),
  atStopName: z.string(),
  minutes: z.number(),
});

export const LirrTripPlanSchema = z.object({
  label: z.string(),
  from: StopRefSchema,
  to: StopRefSchema,
  departAt: z.number(),
  arriveAt: z.number(),
  totalMinutes: z.number(),
  transferCount: z.number(),
  segments: z.array(
    z.discriminatedUnion("type", [LirrRideSegmentSchema, LirrTransferSegmentSchema]),
  ),
});

export const LirrPlanResponseSchema = z.object({
  serviceDate: z.string(),
  plans: z.array(LirrTripPlanSchema),
});
