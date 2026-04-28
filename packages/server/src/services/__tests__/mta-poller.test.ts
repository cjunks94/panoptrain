import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime } = GtfsRealtimeBindings;

/**
 * Builds a minimal valid GTFS-RT FeedMessage protobuf with the given
 * vehicle entities. Used to mock fetch() in poller tests so we can
 * exercise retry / fallback paths without hitting the real MTA endpoints.
 */
function encodeFeed(vehicles: { tripId: string; routeId: string }[]): Uint8Array {
  const feed = transit_realtime.FeedMessage.create({
    header: { gtfsRealtimeVersion: "2.0", timestamp: Math.floor(Date.now() / 1000) },
    entity: vehicles.map((v, i) => ({
      id: `e${i}`,
      vehicle: {
        trip: { tripId: v.tripId, routeId: v.routeId },
        currentStopSequence: 1,
        currentStatus: 2, // IN_TRANSIT_TO
        timestamp: Math.floor(Date.now() / 1000),
        stopId: "STOP1",
      },
    })),
  });
  return transit_realtime.FeedMessage.encode(feed).finish();
}

function okResponse(buf: Uint8Array): Response {
  // Slice copy via .buffer.slice() so the ArrayBuffer is detached from the
  // typed array's underlying SharedArrayBuffer-or-not type, which TS picks
  // apart per node/dom lib version. Functionally identical.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Response(ab, { status: 200, headers: { "content-type": "application/x-protobuf" } });
}

function failResponse(): Response {
  return new Response("upstream down", { status: 503 });
}

/**
 * Poller resilience pins: each MTA feed runs its own retry chain and
 * falls back to a cached parse when fetch fails — without these, a
 * single failed fetch wiped that line's trains from the snapshot for
 * 30s+, which is exactly the prod outage that motivated this code path.
 *
 * The poller module keeps internal state (intervals + per-feed cache)
 * across tests, so we re-import it fresh in each test via vi.resetModules
 * to avoid bleed-through.
 */
describe("mta-poller resilience", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries a failing feed and recovers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(failResponse())
      .mockResolvedValueOnce(okResponse(encodeFeed([{ tripId: "t1", routeId: "1" }])));

    const { fetchOneFeed } = await import("../mta-poller.js");
    const data = await fetchOneFeed("gtfs", "https://example.test/feed");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(data.vehicles).toHaveLength(1);
    expect(data.vehicles[0].tripId).toBe("t1");
  });

  it("throws after all retry attempts exhausted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(failResponse());

    const { fetchOneFeed } = await import("../mta-poller.js");
    await expect(fetchOneFeed("gtfs", "https://example.test/feed")).rejects.toThrow(/HTTP 503/);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("falls back to cached parse when live fetch fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(encodeFeed([{ tripId: "cached", routeId: "1" }])))
      .mockResolvedValue(failResponse());

    const { resolveWithFallback, _resetCache } = await import("../mta-poller.js");
    _resetCache();

    const first = await resolveWithFallback("subway", "gtfs", "https://example.test/feed", Date.now());
    expect(first).not.toBeNull();
    expect(first!.source).toBe("live");
    expect(first!.data.vehicles[0].tripId).toBe("cached");

    const second = await resolveWithFallback("subway", "gtfs", "https://example.test/feed", Date.now());
    expect(second).not.toBeNull();
    expect(second!.source).toBe("cached");
    expect(second!.data.vehicles[0].tripId).toBe("cached");
  });

  it("returns null when fetch fails AND no cached parse exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failResponse());
    const { resolveWithFallback, _resetCache } = await import("../mta-poller.js");
    _resetCache();

    const result = await resolveWithFallback("subway", "gtfs-ace", "https://example.test/feed", Date.now());
    expect(result).toBeNull();
  });

  // Real timers — retry chain is [0ms, 500ms, 1500ms] so each fallback path
  // burns ~2s of wall time. Two fallbacks here → bump above the 5s default.
  it("isolates the cache per (mode, feedId)", { timeout: 15_000 }, async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(encodeFeed([{ tripId: "subway-train", routeId: "1" }])))
      .mockResolvedValueOnce(okResponse(encodeFeed([{ tripId: "lirr-train", routeId: "1" }])))
      .mockResolvedValue(failResponse());

    const { resolveWithFallback, _resetCache } = await import("../mta-poller.js");
    _resetCache();

    await resolveWithFallback("subway", "gtfs", "https://example.test/feed", Date.now());
    await resolveWithFallback("lirr", "gtfs-lirr", "https://example.test/feed", Date.now());

    const subwayFallback = await resolveWithFallback("subway", "gtfs", "https://example.test/feed", Date.now());
    const lirrFallback = await resolveWithFallback("lirr", "gtfs-lirr", "https://example.test/feed", Date.now());

    expect(subwayFallback!.data.vehicles[0].tripId).toBe("subway-train");
    expect(lirrFallback!.data.vehicles[0].tripId).toBe("lirr-train");
  });
});
