/**
 * America/New_York time helpers for the LIRR trip planner.
 *
 * The planner backend treats every `at` instant as ET — it has to, since
 * GTFS service dates and schedule times are anchored there. The client
 * needs to convert two flavors of "user intent" into ET-anchored Date:
 *
 *  1. A raw `<input type="datetime-local">` string ("2026-05-08T19:30")
 *     which the browser hands us in *user-local* wall-clock time. We
 *     reinterpret it AS IF it were ET so a user in PT picking 7:30 PM
 *     means 7:30 PM ET, not 10:30 PM ET.
 *  2. Symbolic presets ("now + 15min", "tomorrow at 8am ET"), which
 *     compute directly in epoch ms and don't need the local-string dance.
 *
 * DST is handled by computing the offset for the *target* date, not for
 * "now" — without that, picking 8am tomorrow on the EDT-to-EST flip
 * morning would land an hour off.
 */

/**
 * Returns the ET offset string ("-04:00" or "-05:00") that applies for a
 * given UTC instant. Whole hours only — ET never observes 30-minute
 * offsets, so we don't bother with minute granularity.
 */
export function etOffsetForDate(date: Date): string {
  const utcMs = date.getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  // Pull each component out by part type so we don't depend on locale string
  // formatting that varies by Node/ICU version.
  const lookup = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // `hour: "2-digit", hour12: false` reports midnight as "24" in some ICU
  // builds; normalize.
  const rawHour = lookup("hour");
  const hour = rawHour === 24 ? 0 : rawHour;
  const etAsUtc = Date.UTC(
    lookup("year"),
    lookup("month") - 1,
    lookup("day"),
    hour,
    lookup("minute"),
    lookup("second"),
  );

  const offsetMin = Math.round((etAsUtc - utcMs) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${sign}${oh}:${om}`;
}

/**
 * Convert a `<input type="datetime-local">` string ("YYYY-MM-DDTHH:mm")
 * to a Date interpreted as ET. Two-pass to handle DST: estimate offset
 * with the current instant, then refine using the target date's offset.
 */
export function localStringToEtDate(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new Error(`Invalid datetime-local string: ${local}`);
  }
  const initial = new Date(`${local}:00${etOffsetForDate(new Date())}`);
  const refined = new Date(`${local}:00${etOffsetForDate(initial)}`);
  return refined;
}

/** Tomorrow at 08:00 ET, expressed as a Date. */
export function tomorrow8amET(now: Date = new Date()): Date {
  // Format tomorrow's date using ET so day-rollover happens at ET midnight,
  // not the user's local midnight. en-CA gives "YYYY-MM-DD" reliably.
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(tomorrow);
  return localStringToEtDate(`${dateStr}T08:00`);
}
