import type { TrainPosition, Mode } from "@panoptrain/shared";

interface Snapshot {
  timestamp: number;
  trains: TrainPosition[];
  /** Feed ids served from the fallback cache or dropped in this poll (#143). */
  degradedFeeds: string[];
}

interface ModeSnapshots {
  current: Snapshot | null;
  previous: Snapshot | null;
}

const snapshots: Record<Mode, ModeSnapshots> = {
  subway: { current: null, previous: null },
  lirr: { current: null, previous: null },
};

export function updateCache(mode: Mode, trains: TrainPosition[], degradedFeeds: string[] = []): void {
  const s = snapshots[mode];
  s.previous = s.current;
  s.current = { timestamp: Date.now(), trains, degradedFeeds: [...degradedFeeds] };
}

export function getCurrentSnapshot(mode: Mode): Snapshot | null {
  return snapshots[mode].current;
}

export function getPreviousSnapshot(mode: Mode): Snapshot | null {
  return snapshots[mode].previous;
}

/** Test-only: return a mode to the cold-start state (no snapshot yet). */
export function _resetCacheForTests(mode: Mode): void {
  snapshots[mode] = { current: null, previous: null };
}
