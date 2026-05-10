import type { TafPeriod } from "@panoptrain/shared";

/**
 * Pick the active base period for a TAF at a given moment.
 *
 * TAFs are composed of a base forecast (fcstChange === null at index 0,
 * or "FM" for subsequent base shifts) plus optional overlay groups
 * (TEMPO, BECMG, PROB) that modify the base during a sub-window. For
 * the popup's at-a-glance summary, we surface the current base period
 * — overlay groups remain visible in the raw TAF if the pilot expands.
 *
 * Returns null if there are no base periods at all (degenerate TAF).
 */
export function findCurrentTafPeriod(
  forecasts: TafPeriod[],
  now: number = Date.now(),
): TafPeriod | null {
  const basePeriods = forecasts.filter(
    (p) => p.fcstChange === null || p.fcstChange === "FM",
  );
  if (basePeriods.length === 0) return null;

  // Latest base period whose start is at or before `now` is the active
  // one. If `now` precedes the entire TAF (just-issued, viewer ahead),
  // fall back to the first base period as the best representation.
  let active: TafPeriod | null = null;
  for (const p of basePeriods) {
    if (p.timeFrom <= now) active = p;
  }
  return active ?? basePeriods[0];
}
