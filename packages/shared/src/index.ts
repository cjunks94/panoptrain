// Types
export type { GtfsStop, GtfsRoute, GtfsShape, GtfsTrip, GtfsStopTime, StopOnShape } from "./types/gtfs.js";
export type {
  TrainPosition,
  TrainsResponse,
  RoutesGeoJSON,
  RouteFeature,
  StopsGeoJSON,
  StopFeature,
  TripPlan,
  PlanResponse,
  RideSegment,
  TransferSegment,
  DelayInfo,
  LirrTripPlan,
  LirrPlanResponse,
  LirrRideSegment,
  LirrTransferSegment,
} from "./types/api.js";
export type {
  ParsedVehicle,
  ParsedTripUpdate,
  StopTimeUpdate,
  ParsedFeedData,
} from "./types/realtime.js";

// Constants
export {
  ROUTE_INFO,
  ALL_ROUTE_IDS,
  ROUTE_GROUPS,
  LIRR_ROUTE_GROUPS,
  ALL_LIRR_ROUTE_IDS,
  routeGroupsForMode,
  allRouteIdsForMode,
} from "./constants/routes.js";
export type { RouteInfo } from "./constants/routes.js";
export {
  SUBWAY_FEEDS,
  LIRR_FEEDS,
  SUBWAY_GTFS_STATIC_URL,
  LIRR_GTFS_STATIC_URL,
  feedsForMode,
  staticGtfsUrlForMode,
} from "./constants/feeds.js";
export type { Mode } from "./constants/feeds.js";

export type { Aircraft, AirspaceResponse } from "./types/airspace.js";
export type { MetarReport, MetarsResponse, FlightCategory } from "./types/metar.js";
export type { TafReport, TafsResponse, TafPeriod } from "./types/taf.js";
export { AIRPORTS } from "./constants/airports.js";
export type { Airport, Runway, RunwaySurface, Frequencies } from "./constants/airports.js";

// Schemas
export {
  TrainPositionSchema,
  TrainsResponseSchema,
  RouteFeatureSchema,
  RoutesGeoJSONSchema,
  StopFeatureSchema,
  StopsGeoJSONSchema,
  DelayInfoSchema,
  RideSegmentSchema,
  TransferSegmentSchema,
  TripPlanSchema,
  PlanResponseSchema,
  LirrRideSegmentSchema,
  LirrTransferSegmentSchema,
  LirrTripPlanSchema,
  LirrPlanResponseSchema,
} from "./schemas/api.schema.js";
export { AircraftSchema, AirspaceResponseSchema } from "./schemas/airspace.schema.js";
export {
  FlightCategorySchema,
  MetarWindSchema,
  MetarReportSchema,
  MetarsResponseSchema,
} from "./schemas/metar.schema.js";
export {
  TafWindSchema,
  TafPeriodSchema,
  TafReportSchema,
  TafsResponseSchema,
} from "./schemas/taf.schema.js";
