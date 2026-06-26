import { describe, it, expect } from "vitest";
import { loadStaticGtfs, type StaticGtfsData } from "../gtfs-loader.js";

/**
 * Cross-module GTFS invariants (#92). The trip-planner and the position-
 * interpolator both consume `gtfs.shapes`, `gtfs.stopSequences`, and
 * `gtfs.stopDistances`, and assume they stay aligned. A loader bug or
 * fixture-refresh script bug that decouples these would surface as
 * silently-wrong train positions or planner segments — a fuzzy UX
 * regression that no existing test catches.
 *
 * This module asserts the contract at the data layer. The corruption
 * tests are sanity checks confirming the consistency check actually
 * catches real divergence.
 */

type ConsistencyErrorKind =
  | "pattern-shape-missing"
  | "pattern-distances-missing"
  | "sequence-stop-not-in-distances"
  | "sequence-not-strictly-increasing";

interface ConsistencyError {
  kind: ConsistencyErrorKind;
  detail: string;
}

/**
 * patternKey format is `routeId-directionId-shapeId`. Some shapeIds
 * contain dashes themselves — everything after the second dash is the
 * shapeId. Returns null for patternKeys with an empty shapeId (e.g.
 * `4-0-`, which the trip-planner skips by design when a route has no
 * published shape data).
 */
function parsePatternKey(patternKey: string): { shapeId: string } | null {
  const parts = patternKey.split("-");
  if (parts.length < 3) return null;
  const shapeId = parts.slice(2).join("-");
  if (shapeId === "") return null;
  return { shapeId };
}

function checkGtfsConsistency(data: StaticGtfsData): ConsistencyError[] {
  const errors: ConsistencyError[] = [];

  for (const [patternKey, sequence] of Object.entries(data.stopSequences)) {
    const parsed = parsePatternKey(patternKey);
    if (!parsed) continue;
    const { shapeId } = parsed;

    if (!data.shapes[shapeId]) {
      errors.push({
        kind: "pattern-shape-missing",
        detail: `patternKey ${patternKey} references shape ${shapeId} but it's not in gtfs.shapes`,
      });
    }

    const distances = data.stopDistances[shapeId];
    if (!distances) {
      errors.push({
        kind: "pattern-distances-missing",
        detail: `patternKey ${patternKey} references shape ${shapeId} but it's not in gtfs.stopDistances`,
      });
      continue;
    }

    let prevSeq = -Infinity;
    for (const { stopId, stopSequence } of sequence) {
      if (!(stopId in distances)) {
        errors.push({
          kind: "sequence-stop-not-in-distances",
          detail: `${patternKey}: stop ${stopId} (seq ${stopSequence}) is in stopSequences but not in stopDistances[${shapeId}]`,
        });
      }
      if (stopSequence <= prevSeq) {
        errors.push({
          kind: "sequence-not-strictly-increasing",
          detail: `${patternKey}: stopSequence ${stopSequence} ≤ previous ${prevSeq} at stop ${stopId}`,
        });
      }
      prevSeq = stopSequence;
    }
  }

  return errors;
}

describe("GTFS consistency — subway", () => {
  it("has aligned shapes, stopSequences, and stopDistances across the full dataset", () => {
    const gtfs = loadStaticGtfs("subway");
    const errors = checkGtfsConsistency(gtfs);

    // Surface up to 5 errors in the failure message so debugging doesn't
    // require re-running with logs.
    expect(errors.slice(0, 5)).toEqual([]);
  });
});

describe("GTFS consistency — LIRR", () => {
  it("has aligned shapes, stopSequences, and stopDistances across the full dataset", () => {
    let gtfs: StaticGtfsData;
    try {
      gtfs = loadStaticGtfs("lirr");
    } catch {
      // LIRR data not downloaded locally — CI always has it (see
      // .github/workflows/ci.yml), local dev may not. Skip cleanly.
      return;
    }

    const errors = checkGtfsConsistency(gtfs);
    expect(errors.slice(0, 5)).toEqual([]);
  });
});

describe("GTFS consistency — corruption sanity checks", () => {
  it("flags pattern-shape-missing when a referenced shape is removed", () => {
    const gtfs = loadStaticGtfs("subway");
    const firstPattern = Object.keys(gtfs.stopSequences).find(
      (k) => parsePatternKey(k) !== null,
    )!;
    const shapeId = parsePatternKey(firstPattern)!.shapeId;

    const corrupted: StaticGtfsData = {
      ...gtfs,
      shapes: Object.fromEntries(
        Object.entries(gtfs.shapes).filter(([k]) => k !== shapeId),
      ),
    };
    const errors = checkGtfsConsistency(corrupted);

    expect(errors.some((e) => e.kind === "pattern-shape-missing" && e.detail.includes(shapeId))).toBe(true);
  });

  it("flags pattern-distances-missing when a shape's distances are removed", () => {
    const gtfs = loadStaticGtfs("subway");
    const firstPattern = Object.keys(gtfs.stopSequences).find(
      (k) => parsePatternKey(k) !== null,
    )!;
    const shapeId = parsePatternKey(firstPattern)!.shapeId;

    const corrupted: StaticGtfsData = {
      ...gtfs,
      stopDistances: Object.fromEntries(
        Object.entries(gtfs.stopDistances).filter(([k]) => k !== shapeId),
      ),
    };
    const errors = checkGtfsConsistency(corrupted);

    expect(errors.some((e) => e.kind === "pattern-distances-missing" && e.detail.includes(shapeId))).toBe(true);
  });

  it("flags sequence-stop-not-in-distances when a stop appears in a sequence but is absent from distances", () => {
    const gtfs = loadStaticGtfs("subway");
    const firstPattern = Object.keys(gtfs.stopSequences).find(
      (k) => parsePatternKey(k) !== null,
    )!;
    const shapeId = parsePatternKey(firstPattern)!.shapeId;
    const firstStop = gtfs.stopSequences[firstPattern]![0]!.stopId;

    const corrupted: StaticGtfsData = {
      ...gtfs,
      stopDistances: {
        ...gtfs.stopDistances,
        [shapeId]: Object.fromEntries(
          Object.entries(gtfs.stopDistances[shapeId]!).filter(([k]) => k !== firstStop),
        ),
      },
    };
    const errors = checkGtfsConsistency(corrupted);

    expect(errors.some((e) => e.kind === "sequence-stop-not-in-distances" && e.detail.includes(firstStop))).toBe(true);
  });

  it("flags sequence-not-strictly-increasing when stopSequence values regress", () => {
    const gtfs = loadStaticGtfs("subway");
    const firstPattern = Object.keys(gtfs.stopSequences).find(
      (k) => parsePatternKey(k) !== null,
    )!;
    const sequence = gtfs.stopSequences[firstPattern]!;

    // Mutate the second entry to have a stopSequence ≤ the first.
    const corruptedSeq = sequence.map((s, i) =>
      i === 1 ? { ...s, stopSequence: sequence[0]!.stopSequence } : s,
    );
    const corrupted: StaticGtfsData = {
      ...gtfs,
      stopSequences: { ...gtfs.stopSequences, [firstPattern]: corruptedSeq },
    };
    const errors = checkGtfsConsistency(corrupted);

    expect(errors.some((e) => e.kind === "sequence-not-strictly-increasing")).toBe(true);
  });
});
