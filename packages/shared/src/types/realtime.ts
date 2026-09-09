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

/**
 * A StopTimeEvent's `time` is null when the feed omitted it (delay-only
 * events are legal GTFS-RT). The parser normalizes protobuf's 0 default to
 * null so consumers' `arrival?.time ?? departure?.time` chains fall through
 * instead of reading 0 as a real epoch (#139).
 */
export interface StopTimeUpdate {
  stopId: string;
  stopSequence: number;
  arrival: { time: number | null; delay: number } | null;
  departure: { time: number | null; delay: number } | null;
}

/** Combined feed data after parsing */
export interface ParsedFeedData {
  feedId: string;
  timestamp: number;
  vehicles: ParsedVehicle[];
  tripUpdates: ParsedTripUpdate[];
}
