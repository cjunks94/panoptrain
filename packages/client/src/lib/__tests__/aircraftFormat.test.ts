import { describe, it, expect } from "vitest";
import {
  displayCallsign,
  formatAltitude,
  formatGroundSpeed,
  formatTrack,
  aircraftKind,
} from "../aircraftFormat.js";

describe("displayCallsign", () => {
  it("prefers callsign over hex", () => {
    expect(displayCallsign({ callsign: "JBU123", hex: "a1b2c3" })).toBe("JBU123");
  });
  it("falls back to upper-case hex when no callsign", () => {
    expect(displayCallsign({ callsign: null, hex: "a1b2c3" })).toBe("A1B2C3");
  });
  it("falls back to hex when callsign is whitespace-only", () => {
    expect(displayCallsign({ callsign: "   ", hex: "deadbe" })).toBe("DEADBE");
  });
});

describe("formatAltitude", () => {
  it("comma-groups thousands", () => {
    expect(formatAltitude(35_000)).toBe("35,000 ft");
  });
  it("renders \"Ground\" for non-positive values", () => {
    expect(formatAltitude(0)).toBe("Ground");
    expect(formatAltitude(-10)).toBe("Ground");
  });
  it("uses an em-dash for null (distinct from \"Ground\")", () => {
    expect(formatAltitude(null)).toBe("—");
  });
});

describe("formatGroundSpeed", () => {
  it("rounds to whole knots", () => {
    expect(formatGroundSpeed(449.7)).toBe("450 kt");
  });
  it("returns em-dash for null", () => {
    expect(formatGroundSpeed(null)).toBe("—");
  });
});

describe("formatTrack", () => {
  it("zero-pads to three digits", () => {
    expect(formatTrack(7)).toBe("007° N");
  });
  it("normalizes negative + over-360 inputs", () => {
    expect(formatTrack(-10)).toBe("350° N");
    expect(formatTrack(450)).toBe("090° E");
  });
  it("picks the cardinal nearest to the bearing", () => {
    expect(formatTrack(45)).toBe("045° NE");
    expect(formatTrack(180)).toBe("180° S");
    expect(formatTrack(270)).toBe("270° W");
  });
  it("returns em-dash for null", () => {
    expect(formatTrack(null)).toBe("—");
  });
});

describe("aircraftKind", () => {
  it("classifies A7 as helicopter", () => {
    expect(aircraftKind("A7")).toBe("helicopter");
  });
  it("classifies A1-A6 as fixed-wing", () => {
    expect(aircraftKind("A1")).toBe("fixed-wing");
    expect(aircraftKind("A3")).toBe("fixed-wing");
    expect(aircraftKind("A6")).toBe("fixed-wing");
  });
  it("returns unknown for null / surface vehicle / unfamiliar codes", () => {
    expect(aircraftKind(null)).toBe("unknown");
    expect(aircraftKind("B2")).toBe("unknown");
    expect(aircraftKind("Z9")).toBe("unknown");
  });
});
