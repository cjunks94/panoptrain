import type { TrainPosition } from "@panoptrain/shared";

interface Snapshot {
  timestamp: number;
  trains: TrainPosition[];
}

let current: Snapshot | null = null;
let previous: Snapshot | null = null;

export function updateCache(trains: TrainPosition[]): void {
  previous = current;
  current = { timestamp: Date.now(), trains };
}

export function getCurrentSnapshot(): Snapshot | null {
  return current;
}

export function getPreviousSnapshot(): Snapshot | null {
  return previous;
}
