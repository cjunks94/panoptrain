const MTA_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds";

/** Top-level transit mode. Subway is the original; LIRR added in Epic 5. */
export type Mode = "subway" | "lirr";

/** MTA GTFS-RT feed endpoints — no API key required for subway or LIRR.
 *  Note: the slash between agency and feed name must be URL-encoded as %2F */
export const SUBWAY_FEEDS = [
  { id: "gtfs", url: `${MTA_BASE}/nyct%2Fgtfs`, lines: ["1", "2", "3", "4", "5", "6", "6X", "7", "7X", "GS"] },
  { id: "gtfs-ace", url: `${MTA_BASE}/nyct%2Fgtfs-ace`, lines: ["A", "C", "E", "FS", "H"] },
  { id: "gtfs-bdfm", url: `${MTA_BASE}/nyct%2Fgtfs-bdfm`, lines: ["B", "D", "F", "FX", "M"] },
  { id: "gtfs-nqrw", url: `${MTA_BASE}/nyct%2Fgtfs-nqrw`, lines: ["N", "Q", "R", "W"] },
  { id: "gtfs-jz", url: `${MTA_BASE}/nyct%2Fgtfs-jz`, lines: ["J", "Z"] },
  { id: "gtfs-l", url: `${MTA_BASE}/nyct%2Fgtfs-l`, lines: ["L"] },
  { id: "gtfs-g", url: `${MTA_BASE}/nyct%2Fgtfs-g`, lines: ["G"] },
  { id: "gtfs-si", url: `${MTA_BASE}/nyct%2Fgtfs-si`, lines: ["SI"] },
] as const;

/** LIRR has a single combined trip-updates + vehicle-positions feed. The
 *  static GTFS enumerates the actual route IDs (Babylon, Hempstead, etc.) —
 *  we don't pre-list them here because they're loaded from data at startup. */
export const LIRR_FEEDS = [
  { id: "gtfs-lirr", url: `${MTA_BASE}/lirr%2Fgtfs-lirr`, lines: [] },
] as const;

/** Static GTFS download URLs — quarterly schedule data, includes shapes,
 *  stops, routes, trips. */
export const SUBWAY_GTFS_STATIC_URL =
  "http://web.mta.info/developers/data/nyct/subway/google_transit.zip";

export const LIRR_GTFS_STATIC_URL =
  "http://web.mta.info/developers/data/lirr/google_transit.zip";

export function feedsForMode(mode: Mode): readonly { id: string; url: string; lines: readonly string[] }[] {
  return mode === "subway" ? SUBWAY_FEEDS : LIRR_FEEDS;
}

export function staticGtfsUrlForMode(mode: Mode): string {
  return mode === "subway" ? SUBWAY_GTFS_STATIC_URL : LIRR_GTFS_STATIC_URL;
}
