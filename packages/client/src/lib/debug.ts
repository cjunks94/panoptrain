/**
 * Lightweight in-browser debug surface for transit-rendering diagnostics.
 *
 * Hooks record events here (poll snapshots, shape-index lifecycle, train
 * positions); `window.__panoptrain` exposes read-only helpers so you can
 * inspect live state from the devtools console without instrumenting prints.
 *
 * Verbose console output is opt-in via `localStorage.PANOPTRAIN_DEBUG = "1"`,
 * or at runtime via `window.__panoptrain.verbose()`. Nothing prints by
 * default — production noise stays zero.
 */
import type { Mode, TrainsResponse, TrainPosition } from "@panoptrain/shared";

interface PollRecord {
  mode: Mode;
  at: number;
  count: number;
  byRoute: Record<string, number>;
}

interface ShapeIndexRecord {
  mode: Mode;
  startedAt: number;
  finishedAt: number | null;
  /** Number of route+direction keys in the index. */
  size: number | null;
  /** Per-route shape counts: routeId → number of shapes indexed. */
  routes: Record<string, number>;
}

interface PositionsSnapshot {
  prev: Map<string, [number, number]>;
  curr: Map<string, [number, number]>;
  /** Live ref to the trackPaths Map. We read `.current` at query time so
   *  pathsCoverage() reflects the slice scheduler's progress without each
   *  slice having to re-record. */
  trackPathsRef: { current: Map<string, unknown> };
  byTripId: Map<string, TrainPosition>;
  mode: Mode;
  at: number;
}

interface CoverageSample {
  pollN: number;
  at: number;
  total: number;
  withPath: number;
}

interface PollHistoryEntry {
  n: number;
  at: number;
  count: number;
  mode: Mode;
}

interface SliceSample {
  pollN: number;
  sliceN: number;
  trains: number;
  ms: number;
  pathsAdded: number;
}

interface PollSkipBreakdown {
  pollN: number;
  total: number;
  noPrev: number;
  stationary: number;
  computed: number;
}

interface PathFailure {
  routeId: string;
  /** "no_shapes" = routeId has no shapes in the index.
   *  "too_far" = closest shape was farther than the threshold. */
  reason: "no_shapes" | "too_far";
  /** Set only when reason === "too_far". */
  bestDistKm: number | null;
  pos: [number, number];
  at: number;
}

interface DebugState {
  verbose: boolean;
  lastPoll: PollRecord | null;
  lastShapeIndex: ShapeIndexRecord | null;
  positions: PositionsSnapshot | null;
  pollSeq: number;
  pollHistory: PollHistoryEntry[];
  coverageHistory: CoverageSample[];
  sliceHistory: SliceSample[];
  pathFailures: PathFailure[];
  skipBreakdowns: PollSkipBreakdown[];
}

const state: DebugState = {
  verbose: readInitialVerbose(),
  lastPoll: null,
  lastShapeIndex: null,
  positions: null,
  pollSeq: 0,
  pollHistory: [],
  coverageHistory: [],
  sliceHistory: [],
  pathFailures: [],
  skipBreakdowns: [],
};

export function recordPathFailure(failure: PathFailure): void {
  state.pathFailures.push(failure);
  if (state.pathFailures.length > 200) state.pathFailures.shift();
}

export function recordSkipBreakdown(breakdown: PollSkipBreakdown): void {
  state.skipBreakdowns.push(breakdown);
  if (state.skipBreakdowns.length > 30) state.skipBreakdowns.shift();
}

export function getCurrentPollSeq(): number {
  return state.pollSeq;
}

export function recordSlice(sample: SliceSample): void {
  state.sliceHistory.push(sample);
  if (state.sliceHistory.length > 200) state.sliceHistory.shift();
}

function readInitialVerbose(): boolean {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem("PANOPTRAIN_DEBUG") === "1";
  } catch {
    return false;
  }
}

export function recordPoll(mode: Mode, data: TrainsResponse): void {
  const byRoute: Record<string, number> = {};
  for (const t of data.trains) {
    byRoute[t.routeId] = (byRoute[t.routeId] ?? 0) + 1;
  }
  state.lastPoll = { mode, at: Date.now(), count: data.trains.length, byRoute };
  state.pollHistory.push({
    n: ++state.pollSeq,
    at: state.lastPoll.at,
    count: data.trains.length,
    mode,
  });
  if (state.pollHistory.length > 30) state.pollHistory.shift();
  // Coverage is captured AFTER each poll so we can see the slice scheduler
  // catching up (or not) over time. Snapshot reads live trackPaths size.
  setTimeout(() => {
    const p = state.positions;
    const sample: CoverageSample = {
      pollN: state.pollSeq,
      at: Date.now(),
      total: p?.byTripId.size ?? 0,
      withPath: p?.trackPathsRef.current.size ?? 0,
    };
    state.coverageHistory.push(sample);
    if (state.coverageHistory.length > 30) state.coverageHistory.shift();
    if (state.verbose) {
      const pct = sample.total === 0 ? 0 : Math.round((sample.withPath / sample.total) * 100);
      console.info(
        `[panoptrain] poll #${sample.pollN} ${mode}: ${sample.total} trains, ${sample.withPath} on-rail (${pct}%)`,
      );
    }
  }, 2000); // 2s post-poll — gives slice scheduler time to settle
  if (state.verbose) {
    console.info(
      `[panoptrain] poll ${mode}: ${data.trains.length} trains`,
      byRoute,
    );
  }
}

export function recordShapeIndexStart(mode: Mode): void {
  state.lastShapeIndex = {
    mode,
    startedAt: performance.now(),
    finishedAt: null,
    size: null,
    routes: {},
  };
  if (state.verbose) console.info(`[panoptrain] shape-index build start (${mode})`);
}

export function recordShapeIndexFinish(
  size: number,
  routes: Record<string, number>,
): void {
  if (!state.lastShapeIndex) return;
  state.lastShapeIndex.finishedAt = performance.now();
  state.lastShapeIndex.size = size;
  state.lastShapeIndex.routes = routes;
  if (state.verbose) {
    const ms = Math.round(state.lastShapeIndex.finishedAt - state.lastShapeIndex.startedAt);
    console.info(
      `[panoptrain] shape-index built: ${size} entries in ${ms}ms (${state.lastShapeIndex.mode})`,
    );
  }
}

export function recordPositions(snapshot: PositionsSnapshot): void {
  state.positions = snapshot;
}

interface PanoptrainDebug {
  /** Verbose console logging on/off at runtime. */
  verbose: (on?: boolean) => boolean;
  /** Most recent poll summary. */
  lastPoll: () => PollRecord | null;
  /** Shape-index lifecycle for the current mode. */
  shapeIndex: () => ShapeIndexRecord | null;
  /** trackPath coverage: how many trains have a computed path. */
  pathsCoverage: () => {
    total: number;
    withPath: number;
    withoutPath: number;
    coveragePct: number;
  } | null;
  /** Per-train inspection: prev/curr position, delta, path flag. */
  inspect: (tripId: string) =>
    | {
        tripId: string;
        routeId: string;
        destination: string;
        prev: [number, number] | null;
        curr: [number, number];
        kmDelta: number | null;
        hasTrackPath: boolean;
      }
    | null;
  /** Snapshot of all current train IDs and their routeId — for triage. */
  trains: () => Array<{ tripId: string; routeId: string; destination: string }>;
  /** Last ~30 polls — to see if cadence drifts or polls stop. */
  pollHistory: () => PollHistoryEntry[];
  /** Last ~30 post-poll coverage samples — to see if paths drop over time. */
  coverageHistory: () => CoverageSample[];
  /** Last ~200 slice samples — diagnose slice scheduler throughput. */
  sliceHistory: () => SliceSample[];
  /** Last ~200 findTrackPath failures — see bestDist distribution to tune threshold. */
  pathFailures: () => PathFailure[];
  /** Per-poll skip breakdown: why each train fell off the path-computation path. */
  skipBreakdowns: () => PollSkipBreakdown[];
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function installDebugSurface(): void {
  if (typeof window === "undefined") return;
  const api: PanoptrainDebug = {
    verbose: (on?: boolean) => {
      if (on !== undefined) {
        state.verbose = on;
        try {
          localStorage.setItem("PANOPTRAIN_DEBUG", on ? "1" : "0");
        } catch {
          /* localStorage may be unavailable (private mode, etc.) */
        }
      }
      return state.verbose;
    },
    lastPoll: () => state.lastPoll,
    shapeIndex: () => state.lastShapeIndex,
    pathsCoverage: () => {
      const p = state.positions;
      if (!p) return null;
      const total = p.byTripId.size;
      const withPath = p.trackPathsRef.current.size;
      const coveragePct = total === 0 ? 0 : Math.round((withPath / total) * 100);
      return { total, withPath, withoutPath: total - withPath, coveragePct };
    },
    inspect: (tripId: string) => {
      const p = state.positions;
      if (!p) return null;
      const train = p.byTripId.get(tripId);
      if (!train) return null;
      const prev = p.prev.get(tripId) ?? null;
      const curr: [number, number] = [train.longitude, train.latitude];
      const kmDelta = prev ? haversineKm(prev, curr) : null;
      return {
        tripId,
        routeId: train.routeId,
        destination: train.destination,
        prev,
        curr,
        kmDelta,
        hasTrackPath: p.trackPathsRef.current.has(tripId),
      };
    },
    trains: () => {
      const p = state.positions;
      if (!p) return [];
      return [...p.byTripId.values()].map((t) => ({
        tripId: t.tripId,
        routeId: t.routeId,
        destination: t.destination,
      }));
    },
    pollHistory: () => [...state.pollHistory],
    coverageHistory: () => [...state.coverageHistory],
    sliceHistory: () => [...state.sliceHistory],
    pathFailures: () => [...state.pathFailures],
    skipBreakdowns: () => [...state.skipBreakdowns],
  };
  (window as unknown as { __panoptrain: PanoptrainDebug }).__panoptrain = api;
}

installDebugSurface();
