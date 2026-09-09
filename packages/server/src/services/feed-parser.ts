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

/**
 * Epoch seconds from a protobuf uint64, or null when the field was unset.
 *
 * protobufjs never yields `undefined` for an unset uint64 — it returns a
 * Long-zero prototype default — so `field ?? fallback` is dead code and
 * every "missing" timestamp silently became 0 (#139). Zero is not a
 * meaningful GTFS-RT time, so it is the presence test.
 */
function toEpochSeconds(value: number | Long | null | undefined): number | null {
  const n = Number(value ?? 0);
  return n > 0 ? n : null;
}

function toStopTimeEvent(
  event: { time?: number | Long | null; delay?: number | null } | null | undefined,
): StopTimeUpdate["arrival"] {
  if (!event) return null;
  return { time: toEpochSeconds(event.time), delay: event.delay ?? 0 };
}

export function parseFeed(feedId: string, buffer: Uint8Array): ParsedFeedData {
  const feed = transit_realtime.FeedMessage.decode(buffer);
  // The header timestamp is optional in the proto. Vehicles without their
  // own timestamp inherit it, so it must be a real time: fall back to the
  // wall clock rather than 0, which the trains route would TTL-evict.
  const timestamp = toEpochSeconds(feed.header.timestamp) ?? Math.floor(Date.now() / 1000);

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
        timestamp: toEpochSeconds(v.timestamp) ?? timestamp,
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
        arrival: toStopTimeEvent(stu.arrival),
        departure: toStopTimeEvent(stu.departure),
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
