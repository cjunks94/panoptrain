# ADR 002: Walk-forward schedule extrapolation past `currentStopId`

## Status

Accepted — 2026-05-23

## Context

`services/position-interpolator.ts` interpolates each train's position
between its previous and current scheduled stops using the trip update's
`stop_time_updates`. The time fraction is computed by
`computeTimeFraction(tu, prevStopId, nextStopId, now)` and clamped to
`[0, 1]` — once `now > arriveNext`, fraction stays at 1.0 and the train
appears parked at `nextStopId` until MTA publishes a new `currentStopId`
on the vehicle entity.

For the **subway** this is fine: feeds update every ~5-15 s and stops
sit 60-90 s apart, so the staleness window is small.

For **LIRR** it's the whole problem. Live debug data via
`window.__panoptrain` (PR #62) showed **~84 % of LIRR trains move
<200 m in any 30 s polling window** — see
`memory/project_lirr_feed_cadence.md`. MTA's LIRR GTFS-RT only
publishes vehicle entities at stop transitions. Stops are 2-10 minutes
apart, so a vehicle's `currentStopId` lags the actual position by
minutes. When MTA finally publishes the new `currentStopId`, the
client's render "jumps" — visible teleport-and-zoom, perceived as
"hitchy."

The data needed to do better is already in the trip update: every
trip update we get carries `stop_time_updates` for every remaining
stop on the trip, each with predicted arrival/departure times.
`estimateFromTripUpdate` (used for trip-update-only entries) already
walks the whole list to find the current leg. `estimateVehicle`
(used when a matching vehicle exists) does not — it keeps the
vehicle's `currentStopId` as the fixed next stop and clamps fraction.

## Decision

Make `estimateVehicle` walk forward past `currentStopId` when `now`
exceeds the arrival time of any subsequent stop. Extract the
walk-forward search into a shared `findCurrentLeg(tripUpdate, now,
startFromStopId)` helper used by both entry points.

When a vehicle is present, its `currentStopId` is used as the **lower
bound** for the search — we never walk backwards even if the vehicle
reports a stop the train has already passed per schedule. Forward
walks are bounded by the end of `stop_time_updates`.

Add `lastObservedAt: number | null` to `TrainPosition`:
- `vehicle.timestamp` when the position derives from a vehicle entity
- `null` when it derives purely from a trip update (no live vehicle)

This lets the client tell the difference between "we observed this
train 5 s ago" and "we last observed this train 4 min ago, the
position you see is schedule-derived." UI consumption is out of scope
for this PR; the field is informational.

`updatedAt` retains its existing semantics — when the position was
last *computed*, regardless of how stale the underlying observation
was. Renaming or repurposing it risks breaking the client's existing
freshness fade (≥ 300 s → 0.35 opacity).

## Consequences

- LIRR trains visibly move continuously across server polls instead
  of standing still and jumping. Subway sees the same improvement
  but the change is barely perceptible (already-fresh observations).
- Position accuracy is bounded by schedule honesty. A train running
  10 min late but still publishing at stops will show interpolated
  positions ahead of where it actually is, until the next vehicle
  observation arrives. `delay` from `trip_update.stop_time_updates`
  is already factored into `arrival.time` — those times are MTA's
  delay-adjusted predictions, not the static schedule — so this is
  better than naive static-schedule extrapolation.
- Trains running ahead of schedule will likewise show behind their
  real positions until the next observation. Same mitigation.
- When a trip ends (`now` past last `stop_time_update`), the train
  is shown at the last stop until the trip update drops out of the
  feed. Matches current behavior; no regression.
- New `lastObservedAt` field threaded through `TrainPosition`,
  `TrainPositionSchema`, and the two construction sites in
  `position-interpolator.ts`. Test fixture builders updated to set
  it to `null` by default.

## Rejected alternatives

- **LIRR-only scope.** The bug is shared; the fix is the same code
  path. Scoping to LIRR would leave the subway interpolator with the
  same latent issue and a divergent implementation. Cost of doing
  both is the same code change; testing covers both via cross-mode
  isolation tests already in place.
- **Client-side extrapolation.** Would duplicate the schedule data
  to the client (currently server-only) and complicate the slice
  scheduler. Server is the right layer — single source of truth, and
  the slice scheduler / interpolation hooks need no changes.
- **Stop interpolating past `arriveNext` entirely and just leave the
  train at the stop.** That's the current behavior, and what produces
  the hitchy feel. Rejected on the user-experience grounds documented
  above.
