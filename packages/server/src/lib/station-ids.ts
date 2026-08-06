/**
 * Parsing and bounding for the comma-separated station ID lists accepted by
 * `/api/plan` and `/api/plan/lirr` (#127).
 *
 * These params exist so the client can select a whole NYC complex by name —
 * Times Sq, Canal St and Atlantic are split across several parent stops in
 * GTFS. That legitimately means more than one ID, but only a handful: the
 * largest same-name parent group in the current subway feed is **6**
 * (`86 St` and `Canal St`), out of 496 parent stations across 379 distinct
 * names.
 *
 * Left unbounded, the list was a cheap way to make the server do expensive
 * work: every ID expands to platforms and seeds the Dijkstra frontier, and
 * `planTrips` re-runs that seeded search several times for alternatives.
 * Repeating one *valid* ID passed the existence check, so no unusual input
 * was needed.
 *
 * MAX_STATION_IDS is deliberately 2x the observed maximum — generous enough
 * that a schedule change can't break a legitimate request, small enough that
 * the seeded search stays trivial.
 */
export const MAX_STATION_IDS = 12;

export type StationIdsResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/**
 * Splits a comma-separated station ID list, trims blanks, removes duplicates
 * and enforces the count ceiling.
 *
 * Deduplication happens before the count check so that a caller repeating the
 * same station is treated as the one station it actually denotes, rather than
 * being rejected for a limit it never meaningfully exceeded.
 */
export function parseStationIds(raw: string, paramName: string): StationIdsResult {
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];

  if (ids.length === 0) {
    return { ok: false, error: `Empty '${paramName}' query parameter` };
  }
  if (ids.length > MAX_STATION_IDS) {
    return {
      ok: false,
      error: `Too many '${paramName}' station IDs (max ${MAX_STATION_IDS})`,
    };
  }
  return { ok: true, ids };
}
