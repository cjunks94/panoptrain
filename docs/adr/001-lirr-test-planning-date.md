# ADR 001: Compute LIRR planner-test date from the loaded schedule

## Status

Accepted — 2026-05-21

## Context

`packages/server/src/services/__tests__/lirr-trip-planner.test.ts` hardcoded
`MONDAY_3PM_EPOCH_MS = Date.UTC(2026, 4, 4, 19, 0, 0)` — May 4, 2026, 3 PM
NY-local — and passed it as `departAfterMs` into `planLirrTrips()`.

The LIRR GTFS schedule data refreshed by `pnpm download-gtfs:lirr` rotates its
validity window forward over time: `calendar_dates.txt` only covers a few
months. When the current snapshot's window no longer includes May 4, 2026,
the planner sees zero active services on that date, returns 0 plans, and
every assertion in the file fails with cascading `undefined` reads.

This happened on CI when the cached schedule data evicted and the next run
re-downloaded a window starting after May 4. Local runs against an older
cache still passed, masking the failure mode behind cache state.

## Decision

The test computes its planning timestamp dynamically from the loaded
schedule. A helper picks the first weekday inside `schedule.calendarDates`
with ≥5 active services and returns 3 PM NY-local on that date as epoch ms.
The helper lives co-located in the test file — used in one place, no need
for a shared util.

Considered and rejected:

- **Vendor a frozen schedule fixture under `__tests__/fixtures/`.** Locks the
  data forever, but commits a few MB of JSON and stops exercising the real
  `loadLirrSchedule()` loader from these tests. The loader has its own
  branches (cache hit/miss, file-missing error path) worth covering
  alongside planner logic.

- **Freeze time with `vi.useFakeTimers()`.** The planner doesn't read
  `Date.now()` along this code path — the timestamp comes in as an argument.
  Freezing the clock changes nothing.

- **Update the hardcoded date periodically.** Just shifts the rot. Same
  failure mode in 3-6 months.

## Consequences

- Tests move with the schedule snapshot. The chosen date varies run-to-run
  as data rotates, but is deterministic per-snapshot — every assertion that
  refers to "the planning timestamp" reads from the same derived value.
- Assertions tied to specific stop pairs (Penn → Babylon direct, Babylon →
  Hempstead transfer via Jamaica) still depend on LIRR continuing to operate
  those services. That's a real-world dependency we accept; if MTA ever
  drops them, these tests should reasonably need updating.
- The helper requires ≥5 services on the chosen date to ensure a reasonable
  service level. If a future snapshot starts with several low-service days
  (e.g. a long holiday weekend at the window boundary), the helper steps
  past them. If the entire loaded window has no qualifying day, it throws
  with a clear message — a louder failure than the silent 0-plans we had
  before.
