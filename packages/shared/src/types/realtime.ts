/** Parsed vehicle entity from GTFS-RT feed */
export interface ParsedVehicle {
  tripId: string;
  routeId: string;
  directionId: number;
  currentStopSequence: number;
  currentStopId: string;
  currentStatus: "STOPPED_AT" | "INCOMING_AT" | "IN_TRANSIT_TO";
  timestamp: number;
}

/** Parsed trip update entity from GTFS-RT feed */
export interface ParsedTripUpdate {
  tripId: string;
  routeId: string;
  directionId: number;
  stopTimeUpdates: StopTimeUpdate[];
}

export interface StopTimeUpdate {
  stopId: string;
  stopSequence: number;
  arrival: { time: number; delay: number } | null;
  departure: { time: number; delay: number } | null;
}

/** Combined feed data after parsing */
export interface ParsedFeedData {
  feedId: string;
  timestamp: number;
  vehicles: ParsedVehicle[];
  tripUpdates: ParsedTripUpdate[];
}
