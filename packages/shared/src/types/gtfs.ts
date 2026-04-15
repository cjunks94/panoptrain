/** A stop/station from stops.txt */
export interface GtfsStop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
  parentStation: string | null;
}

/** A route from routes.txt */
export interface GtfsRoute {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
}

/** A processed route shape as a GeoJSON-compatible coordinate array */
export interface GtfsShape {
  shapeId: string;
  coordinates: [number, number][]; // [lon, lat] pairs
}

/** A trip from trips.txt linking route, shape, and direction */
export interface GtfsTrip {
  tripId: string;
  routeId: string;
  shapeId: string;
  directionId: number;
  tripHeadsign: string;
}

/** Stop time entry from stop_times.txt */
export interface GtfsStopTime {
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime: string;
  departureTime: string;
}

/** Pre-computed stop position along a shape */
export interface StopOnShape {
  stopId: string;
  shapeId: string;
  distanceAlongRoute: number; // km from start of shape
}
