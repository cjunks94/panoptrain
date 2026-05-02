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
  /** The poll snapshot prior to the current one (~one POLL_INTERVAL earlier).
   *  Lets the client bootstrap interpolation immediately on the first poll —
   *  without it, trains sit motionless until the second poll arrives 30s
   *  later because the client has nothing to interpolate FROM. Absent if
   *  the server has only ever taken one snapshot since startup. */
  previous?: {
    timestamp: number;
    trains: TrainPosition[];
  };
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
    /** Visual prominence for the map: 0 = local stop, 1 = mid-tier (mid
     *  subway interchange or LIRR branch terminal), 2 = major hub (Times
     *  Sq, Atlantic, Penn, Jamaica). Replaces the prior `routeCount`-based
     *  thresholds at the layer level so the rendering can be calibrated
     *  per mode at the API rather than hard-coded into MapLibre filters. */
    importance?: 0 | 1 | 2;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

/** A single planned trip — one of potentially multiple alternatives. */
export interface TripPlan {
  /** Human-readable label, e.g. "Recommended" or "Avoids Q". */
  label: string;
  from: { stopId: string; stopName: string };
  to: { stopId: string; stopName: string };
  totalMinutes: number;
  totalStops: number;
  transferCount: number;
  segments: Array<RideSegment | TransferSegment>;
}

/** Response from GET /api/plan — primary plan first, then alternatives. */
export interface PlanResponse {
  plans: TripPlan[];
}

/** Live-delay information aggregated across all observed trains on a ride
 *  segment. `null` (on `RideSegment`) means we couldn't see any trains
 *  serving these stops in the current snapshot — different signal than
 *  "we observed N trains and they were all on time". */
export interface DelayInfo {
  minSeconds: number;
  maxSeconds: number;
  /** Number of trains contributing data to this aggregate. */
  trainsObserved: number;
}

export interface RideSegment {
  type: "ride";
  routeId: string;
  boardAt: { stopId: string; stopName: string };
  alightAt: { stopId: string; stopName: string };
  stops: Array<{ stopId: string; stopName: string }>;
  path: [number, number][];
  intermediateStops: number;
  minutes: number;
  delay: DelayInfo | null;
}

export interface TransferSegment {
  type: "transfer";
  atStopName: string;
  minutes: number;
}

/**
 * Schedule-based LIRR trip plan. Unlike the subway TripPlan which only
 * carries minute durations (subway service is frequent enough that "15 min"
 * is more useful than "departs 6:47"), LIRR plans must carry absolute
 * departure/arrival timestamps — the next train may be 45 minutes away.
 */
export interface LirrTripPlan {
  /** Human-readable label, e.g. "6:47 → 7:23". */
  label: string;
  from: { stopId: string; stopName: string };
  to: { stopId: string; stopName: string };
  /** Boarding time at origin (epoch ms, NY-local on the wire). */
  departAt: number;
  /** Arrival time at destination (epoch ms). */
  arriveAt: number;
  /** Total minutes including transfer waits — derived but cached for the UI. */
  totalMinutes: number;
  transferCount: number;
  segments: Array<LirrRideSegment | LirrTransferSegment>;
}

export interface LirrRideSegment {
  type: "ride";
  /** GTFS routeId (Babylon, Hempstead, etc.) — maps to LIRR_ROUTE_GROUPS. */
  routeId: string;
  /** GTFS tripId — useful for cross-referencing with the live train feed. */
  tripId: string;
  /** Headsign shown on the train (e.g. "Babylon"). */
  tripHeadsign: string;
  boardAt: { stopId: string; stopName: string };
  alightAt: { stopId: string; stopName: string };
  /** Ordered intermediate stops along the trip between board and alight,
   *  inclusive of both endpoints. Each carries its scheduled arrival. */
  stops: Array<{ stopId: string; stopName: string; arriveAt: number }>;
  /** Boarding (origin) departure time, epoch ms. */
  departAt: number;
  /** Alighting (destination) arrival time, epoch ms. */
  arriveAt: number;
  /** Coordinate path along the route shape, [lon, lat]. */
  path: [number, number][];
}

export interface LirrTransferSegment {
  type: "transfer";
  atStopId: string;
  atStopName: string;
  /** Wait time at the transfer station in minutes. */
  minutes: number;
}

/** Response from GET /api/plan/lirr — earliest-arriving plans first. */
export interface LirrPlanResponse {
  /** Service date used to resolve schedule, formatted YYYY-MM-DD in NY tz.
   *  Mostly informational — useful for clients that want to display
   *  "Service date: Fri May 1" alongside the plan. */
  serviceDate: string;
  plans: LirrTripPlan[];
}
