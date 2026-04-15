import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { ParsedVehicle, ParsedTripUpdate, ParsedFeedData, StopTimeUpdate } from "@panoptrain/shared";

const { transit_realtime } = GtfsRealtimeBindings;

const STATUS_MAP: Record<number, ParsedVehicle["currentStatus"]> = {
  0: "INCOMING_AT",
  1: "STOPPED_AT",
  2: "IN_TRANSIT_TO",
};

/**
 * MTA real-time trip IDs encode direction: "..N" = northbound (0), "..S" = southbound (1).
 * The protobuf directionId field is often unset, so we parse it from the trip ID.
 */
function parseDirection(tripId: string, protobufDirection: number | null | undefined): number {
  if (tripId.includes("..S")) return 1;
  if (tripId.includes("..N")) return 0;
  return protobufDirection ?? 0;
}

export function parseFeed(feedId: string, buffer: Uint8Array): ParsedFeedData {
  const feed = transit_realtime.FeedMessage.decode(buffer);
  const timestamp = Number(feed.header.timestamp ?? 0);

  const vehicles: ParsedVehicle[] = [];
  const tripUpdates: ParsedTripUpdate[] = [];

  for (const entity of feed.entity) {
    // Parse VehiclePosition entities
    if (entity.vehicle?.trip?.tripId) {
      const v = entity.vehicle;
      const trip = v.trip!;
      const tripId = trip.tripId!;
      vehicles.push({
        tripId,
        routeId: trip.routeId ?? "",
        directionId: parseDirection(tripId, trip.directionId),
        currentStopSequence: v.currentStopSequence ?? 0,
        currentStopId: v.stopId ?? "",
        currentStatus: STATUS_MAP[v.currentStatus ?? 2] ?? "IN_TRANSIT_TO",
        timestamp: Number(v.timestamp ?? timestamp),
      });
    }

    // Parse TripUpdate entities
    if (entity.tripUpdate?.trip?.tripId) {
      const tu = entity.tripUpdate;
      const trip = tu.trip!;
      const tripId = trip.tripId!;
      const stopTimeUpdates: StopTimeUpdate[] = (tu.stopTimeUpdate ?? []).map((stu) => ({
        stopId: stu.stopId ?? "",
        stopSequence: stu.stopSequence ?? 0,
        arrival: stu.arrival
          ? { time: Number(stu.arrival.time ?? 0), delay: stu.arrival.delay ?? 0 }
          : null,
        departure: stu.departure
          ? { time: Number(stu.departure.time ?? 0), delay: stu.departure.delay ?? 0 }
          : null,
      }));

      tripUpdates.push({
        tripId,
        routeId: trip.routeId ?? "",
        directionId: parseDirection(tripId, trip.directionId),
        stopTimeUpdates,
      });
    }
  }

  return { feedId, timestamp, vehicles, tripUpdates };
}
