import type { TrainPosition, Mode } from "@panoptrain/shared";

interface Snapshot {
  timestamp: number;
  trains: TrainPosition[];
}

interface ModeSnapshots {
  current: Snapshot | null;
  previous: Snapshot | null;
}

const snapshots: Record<Mode, ModeSnapshots> = {
  subway: { current: null, previous: null },
  lirr: { current: null, previous: null },
};

export function updateCache(mode: Mode, trains: TrainPosition[]): void {
  const s = snapshots[mode];
  s.previous = s.current;
  s.current = { timestamp: Date.now(), trains };
}

export function getCurrentSnapshot(mode: Mode): Snapshot | null {
  return snapshots[mode].current;
}

export function getPreviousSnapshot(mode: Mode): Snapshot | null {
  return snapshots[mode].previous;
}
