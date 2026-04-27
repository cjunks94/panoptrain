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
} from "./types/api.js";
export type {
  ParsedVehicle,
  ParsedTripUpdate,
  StopTimeUpdate,
  ParsedFeedData,
} from "./types/realtime.js";

// Constants
export { ROUTE_INFO, ALL_ROUTE_IDS, ROUTE_GROUPS } from "./constants/routes.js";
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

// Schemas
export { TrainPositionSchema, TrainsResponseSchema } from "./schemas/api.schema.js";
