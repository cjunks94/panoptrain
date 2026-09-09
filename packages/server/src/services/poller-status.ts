import type { Mode } from "@panoptrain/shared";

// Stub — implemented in the green commit for #143.

export function markPollerStarted(_mode: Mode): void {}

export function recordPollerStartupFailure(_mode: Mode, _err: unknown): void {}

export function recordPollResult(_mode: Mode, _degradedFeeds: string[]): void {}

export function getPollerState(_mode: Mode): never {
  throw new Error("not implemented");
}

export function _resetPollerStatusForTests(): void {}
