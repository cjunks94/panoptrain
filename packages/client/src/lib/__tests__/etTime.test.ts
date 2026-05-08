import { describe, it, expect } from "vitest";
import { etOffsetForDate, localStringToEtDate, tomorrow8amET } from "../etTime.js";

/**
 * ET wall-clock arithmetic is the most common quietly-broken thing in
 * transit code. These tests pin down the two transitions of the year
 * (March DST start, November DST end) and a couple of representative
 * non-transition dates, so a future "let's just use Date.parse" rewrite
 * will fail loudly.
 */

describe("etOffsetForDate", () => {
  it("returns -05:00 mid-January (EST)", () => {
    expect(etOffsetForDate(new Date("2026-01-15T12:00:00Z"))).toBe("-05:00");
  });

  it("returns -04:00 mid-July (EDT)", () => {
    expect(etOffsetForDate(new Date("2026-07-15T12:00:00Z"))).toBe("-04:00");
  });

  it("returns -04:00 just after the spring-forward DST flip", () => {
    // 2026 DST starts 2026-03-08 at 02:00 ET. 12:00 UTC on that date is
    // 08:00 EDT.
    expect(etOffsetForDate(new Date("2026-03-08T12:00:00Z"))).toBe("-04:00");
  });

  it("returns -05:00 just after the fall-back DST flip", () => {
    // 2026 DST ends 2026-11-01 at 02:00 ET. 12:00 UTC on that date is
    // 07:00 EST.
    expect(etOffsetForDate(new Date("2026-11-01T12:00:00Z"))).toBe("-05:00");
  });
});

describe("localStringToEtDate", () => {
  it("interprets a winter datetime as EST regardless of the host machine's TZ", () => {
    // 2026-01-15T08:00 ET = 2026-01-15T13:00 UTC (EST = UTC-5).
    const d = localStringToEtDate("2026-01-15T08:00");
    expect(d.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("interprets a summer datetime as EDT regardless of the host machine's TZ", () => {
    // 2026-07-15T08:00 ET = 2026-07-15T12:00 UTC (EDT = UTC-4).
    const d = localStringToEtDate("2026-07-15T08:00");
    expect(d.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("uses the target date's offset, not 'now's, across DST boundaries", () => {
    // If we naively used the offset for "now" (today, May), composing
    // "2026-12-15T08:00" with -04:00 would land an hour early. The two-pass
    // refinement should converge on -05:00 for that date.
    const winter = localStringToEtDate("2026-12-15T08:00");
    expect(winter.toISOString()).toBe("2026-12-15T13:00:00.000Z");
  });

  it("throws on a malformed input", () => {
    expect(() => localStringToEtDate("2026-05-08")).toThrow();
    expect(() => localStringToEtDate("not a date")).toThrow();
  });
});

describe("tomorrow8amET", () => {
  it("returns 08:00 ET on the day after the supplied instant (ET calendar)", () => {
    // 2026-07-15 18:00 ET → tomorrow = 2026-07-16; 08:00 EDT = 12:00 UTC.
    const now = new Date("2026-07-15T22:00:00Z"); // 18:00 EDT
    const t = tomorrow8amET(now);
    expect(t.toISOString()).toBe("2026-07-16T12:00:00.000Z");
  });

  it("rolls over by ET midnight, not host-local midnight", () => {
    // Pick a UTC instant that's already "tomorrow" in UTC but still
    // "today" in ET. 2026-07-15T03:30Z = 23:30 EDT on 2026-07-14, so the
    // ET calendar says "tomorrow" is 2026-07-15, even though host-local
    // (assuming UTC) would say 2026-07-16.
    const now = new Date("2026-07-15T03:30:00Z");
    const t = tomorrow8amET(now);
    expect(t.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });
});
