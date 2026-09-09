import type { Mode } from "@panoptrain/shared";

/**
 * Per-mode transit poller state, read by /api/health (#143).
 *
 * The pollers themselves are fire-and-forget: index.ts catches a GTFS load
 * failure, logs it, and moves on, so before this registry nothing outside
 * the log knew that a poller had never started. Railway's healthcheck
 * promoted such revisions and /api/trains served an empty 200 forever.
 */
export interface PollerState {
  started: boolean;
  /** Epoch ms when startPolling ran; null until then. */
  startedAt: number | null;
  /** Epoch ms of the last completed poll (live, cached, or dropped feeds). */
  lastPollAt: number | null;
  /** Feed ids that were served from the fallback cache or dropped on the
   *  last poll. Empty when every feed was live. */
  degradedFeeds: string[];
  /** Why the poller failed to start, when it did. */
  error: string | null;
}

function fresh(): PollerState {
  return { started: false, startedAt: null, lastPollAt: null, degradedFeeds: [], error: null };
}

const states: Record<Mode, PollerState> = { subway: fresh(), lirr: fresh() };

export function markPollerStarted(mode: Mode): void {
  states[mode] = { ...fresh(), started: true, startedAt: Date.now() };
}

export function recordPollerStartupFailure(mode: Mode, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  states[mode] = { ...fresh(), error: message };
}

export function recordPollResult(mode: Mode, degradedFeeds: string[]): void {
  const s = states[mode];
  s.lastPollAt = Date.now();
  s.degradedFeeds = [...degradedFeeds];
}

/** A copy — callers cannot mutate the registry through it. */
export function getPollerState(mode: Mode): PollerState {
  const s = states[mode];
  return { ...s, degradedFeeds: [...s.degradedFeeds] };
}

/** Test-only: forget every poller. */
export function _resetPollerStatusForTests(): void {
  for (const mode of Object.keys(states) as Mode[]) states[mode] = fresh();
}
