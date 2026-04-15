const MTA_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds";

/** MTA GTFS-RT feed endpoints — no API key required for subway.
 *  Note: the slash between "nyct" and the feed name must be URL-encoded as %2F */
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

/** Static GTFS download URL */
export const SUBWAY_GTFS_STATIC_URL =
  "http://web.mta.info/developers/data/nyct/subway/google_transit.zip";
