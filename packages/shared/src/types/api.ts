/** A single train's position as returned by the server API */
export interface TrainPosition {
  tripId: string;
  routeId: string;
  direction: 0 | 1;
  latitude: number;
  longitude: number;
  bearing: number | null;
  status: "STOPPED_AT" | "INCOMING_AT" | "IN_TRANSIT_TO";
  currentStopId: string;
  currentStopName: string;
  nextStopId: string | null;
  nextStopName: string | null;
  destination: string;
  delay: number | null;
  updatedAt: number;
}

/** Response from GET /api/trains */
export interface TrainsResponse {
  timestamp: number;
  count: number;
  trains: TrainPosition[];
}

/** Response from GET /api/routes — GeoJSON */
export interface RoutesGeoJSON {
  type: "FeatureCollection";
  features: RouteFeature[];
}

export interface RouteFeature {
  type: "Feature";
  properties: {
    routeId: string;
    color: string;
    name: string;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

/** Response from GET /api/stops — GeoJSON */
export interface StopsGeoJSON {
  type: "FeatureCollection";
  features: StopFeature[];
}

export interface StopFeature {
  type: "Feature";
  properties: {
    stopId: string;
    stopName: string;
    routes?: string[];
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

/** Trip planner response from GET /api/plan */
export interface TripPlan {
  from: { stopId: string; stopName: string };
  to: { stopId: string; stopName: string };
  totalMinutes: number;
  totalStops: number;
  transferCount: number;
  segments: Array<RideSegment | TransferSegment>;
}

export interface RideSegment {
  type: "ride";
  routeId: string;
  boardAt: { stopId: string; stopName: string };
  alightAt: { stopId: string; stopName: string };
  intermediateStops: number;
  minutes: number;
}

export interface TransferSegment {
  type: "transfer";
  atStopName: string;
  minutes: number;
}
