import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AircraftSchema } from "@panoptrain/shared";

/**
 * Two layers worth pinning here:
 *  1. `parseAdsbLolResponse` — pure function over the upstream payload
 *     shape. Cheap to test, catches breakage if adsb.lol's JSON drifts.
 *  2. The fetch-with-fallback loop — same resilience pattern as the MTA
 *     poller, so we use the same mock-fetch approach.
 *
 * The poller module keeps in-process state (snapshot + cache); we reset
 * via `_resetAirspaceCache` in `beforeEach` and re-import via vi.resetModules
 * for tests that exercise the singleton interval state.
 */
describe("parseAdsbLolResponse", () => {
  it("maps adsb.lol fields onto Aircraft, computing seenAt from now-seen", async () => {
    const { parseAdsbLolResponse } = await import("../airspace-poller.js");
    const upstreamNow = 1_700_000_000_000;
    const result = parseAdsbLolResponse({
      now: upstreamNow,
      ac: [
        {
          hex: "A1B2C3",
          flight: "JBU123  ",
          lat: 40.7,
          lon: -73.9,
          alt_baro: 35_000,
          gs: 450,
          track: 90,
          category: "A3",
          squawk: "1234",
          seen: 0.5,
        },
      ],
    });
    expect(result.sourceTimestamp).toBe(upstreamNow);
    expect(result.aircraft).toHaveLength(1);
    const a = result.aircraft[0]!;
    expect(a.hex).toBe("a1b2c3"); // lower-cased
    expect(a.callsign).toBe("JBU123"); // trimmed
    expect(a.altBaro).toBe(35_000);
    expect(a.seenAt).toBe(upstreamNow - 500);
    // Validate against the shared Zod schema so the type contract holds.
    expect(() => AircraftSchema.parse(a)).not.toThrow();
  });

  it("skips records missing lat/lon (they have nowhere to render)", async () => {
    const { parseAdsbLolResponse } = await import("../airspace-poller.js");
    const result = parseAdsbLolResponse({
      now: 1,
      ac: [
        { hex: "good", lat: 40, lon: -74, seen: 0 },
        { hex: "missing-lat", lon: -74, seen: 0 },
        { hex: "missing-lon", lat: 40, seen: 0 },
      ],
    });
    expect(result.aircraft.map((a) => a.hex)).toEqual(["good"]);
  });

  it("coerces alt_baro=\"ground\" (literal string from adsb.lol) to null", async () => {
    const { parseAdsbLolResponse } = await import("../airspace-poller.js");
    const result = parseAdsbLolResponse({
      now: 1,
      ac: [{ hex: "abc", lat: 40, lon: -74, alt_baro: "ground", seen: 0 }],
    });
    expect(result.aircraft[0]!.altBaro).toBeNull();
  });

  it("treats absent/empty optional strings as null", async () => {
    const { parseAdsbLolResponse } = await import("../airspace-poller.js");
    const result = parseAdsbLolResponse({
      now: 1,
      ac: [{ hex: "abc", lat: 40, lon: -74, flight: "   ", category: "", seen: 0 }],
    });
    const a = result.aircraft[0]!;
    expect(a.callsign).toBeNull();
    expect(a.category).toBeNull();
    expect(a.squawk).toBeNull();
  });

  it("falls back to `now` arg when payload omits its own", async () => {
    const { parseAdsbLolResponse } = await import("../airspace-poller.js");
    const result = parseAdsbLolResponse({ ac: [] }, 12345);
    expect(result.sourceTimestamp).toBe(12345);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("airspace-poller fetch & fallback", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../airspace-poller.js");
    mod._resetAirspaceCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("populates the snapshot on a successful fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({ now: Date.now(), ac: [{ hex: "abc", lat: 40, lon: -74, seen: 0 }] }),
      );
    const { fetchAircraftSnapshot } = await import("../airspace-poller.js");
    const snap = await fetchAircraftSnapshot();
    expect(snap.aircraft).toHaveLength(1);
    expect(snap.source).toBe("live");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("retries on transient fetch failure and succeeds on the third try", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ now: Date.now(), ac: [] }));
    const { fetchAircraftSnapshot } = await import("../airspace-poller.js");
    const promise = fetchAircraftSnapshot();
    // Advance through the retry backoffs (0, 500, 1500ms).
    await vi.advanceTimersByTimeAsync(2_000);
    const snap = await promise;
    expect(snap.aircraft).toEqual([]);
  });

  it("throws after exhausting retries", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream gone"));
    const { fetchAircraftSnapshot } = await import("../airspace-poller.js");
    const promise = fetchAircraftSnapshot();
    promise.catch(() => {}); // hold on to the rejection so vitest doesn't complain
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).rejects.toThrow(/upstream gone/);
  });

  it("rejects malformed upstream payloads via the Zod schema at the parse boundary (#86)", async () => {
    // `ac` declared as array; upstream returns a string instead. fetchWithRetry
    // should treat the Zod failure as a fetch error → retry → exhaust → throw.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ac: "should-be-an-array", now: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { fetchAircraftSnapshot } = await import("../airspace-poller.js");
    const promise = fetchAircraftSnapshot();
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).rejects.toThrow();
  });
});
