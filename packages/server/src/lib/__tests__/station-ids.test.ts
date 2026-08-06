import { describe, it, expect } from "vitest";
import { parseStationIds, MAX_STATION_IDS } from "../station-ids.js";

describe("parseStationIds", () => {
  it("parses a single id", () => {
    expect(parseStationIds("127", "from")).toEqual({ ok: true, ids: ["127"] });
  });

  it("parses and trims a comma-separated list", () => {
    expect(parseStationIds("127, 128 ,129", "from")).toEqual({
      ok: true,
      ids: ["127", "128", "129"],
    });
  });

  it("drops empty segments from stray commas", () => {
    expect(parseStationIds("127,,128,", "from")).toEqual({ ok: true, ids: ["127", "128"] });
  });

  it("rejects an empty or comma-only value", () => {
    expect(parseStationIds("", "from")).toEqual({
      ok: false,
      error: "Empty 'from' query parameter",
    });
    expect(parseStationIds(",,,", "to")).toEqual({
      ok: false,
      error: "Empty 'to' query parameter",
    });
  });

  /** The core of #127: a repeated valid id passed the old existence check and
   *  seeded the frontier once per copy. */
  it("deduplicates repeated ids", () => {
    const repeated = Array(5000).fill("127").join(",");
    expect(parseStationIds(repeated, "from")).toEqual({ ok: true, ids: ["127"] });
  });

  it("dedupes before applying the ceiling, so repetition alone is not an error", () => {
    const repeated = Array(100).fill("127").join(",");
    const result = parseStationIds(repeated, "from");
    expect(result.ok).toBe(true);
  });

  it("accepts exactly MAX_STATION_IDS distinct ids", () => {
    const ids = Array.from({ length: MAX_STATION_IDS }, (_, i) => `s${i}`);
    const result = parseStationIds(ids.join(","), "from");
    expect(result).toEqual({ ok: true, ids });
  });

  it("rejects one more than MAX_STATION_IDS distinct ids", () => {
    const ids = Array.from({ length: MAX_STATION_IDS + 1 }, (_, i) => `s${i}`);
    expect(parseStationIds(ids.join(","), "from")).toEqual({
      ok: false,
      error: `Too many 'from' station IDs (max ${MAX_STATION_IDS})`,
    });
  });

  it("leaves headroom above the largest real same-name station group", () => {
    // Largest same-name parent group in the current subway feed is 6
    // (86 St, Canal St). The ceiling must not reject a legitimate selection.
    expect(MAX_STATION_IDS).toBeGreaterThanOrEqual(12);
  });

  it("names the offending parameter in the error", () => {
    const many = Array.from({ length: MAX_STATION_IDS + 1 }, (_, i) => `s${i}`).join(",");
    expect(parseStationIds(many, "to")).toMatchObject({ error: expect.stringContaining("'to'") });
  });
});
