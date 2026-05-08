/** NYC-metro airport markers rendered as "stations" on the airspace view.
 *  Hardcoded because the list is small, static, and doesn't merit a server
 *  endpoint until enrichment (live ops counts, ETA aggregates) shows up.
 *
 *  Importance buckets mirror the transit station convention (see
 *  stationImportance in server/src/routes/static.ts):
 *    2 = hub      — major commercial gateway, shown earliest, largest dot
 *    1 = major    — secondary commercial / large GA, shown at mid zoom
 *    0 = regional — smaller GA fields, only labeled at high zoom
 */
export interface Airport {
  /** 3-letter IATA code — used as the primary display label ("JFK"). */
  iata: string;
  /** 4-letter ICAO code — included for completeness / tooltip use. */
  icao: string;
  /** Full name without "Airport" suffix (the layer adds context via icon). */
  name: string;
  latitude: number;
  longitude: number;
  importance: 0 | 1 | 2;
}

export const AIRPORTS: readonly Airport[] = [
  // Hubs — the big three NYC commercial gateways.
  { iata: "JFK", icao: "KJFK", name: "John F. Kennedy",     latitude: 40.6413, longitude: -73.7781, importance: 2 },
  { iata: "LGA", icao: "KLGA", name: "LaGuardia",           latitude: 40.7769, longitude: -73.8740, importance: 2 },
  { iata: "EWR", icao: "KEWR", name: "Newark Liberty",      latitude: 40.6925, longitude: -74.1687, importance: 2 },

  // Major secondaries — commercial service or heavy GA / corporate.
  { iata: "HPN", icao: "KHPN", name: "Westchester County",  latitude: 41.0670, longitude: -73.7076, importance: 1 },
  { iata: "ISP", icao: "KISP", name: "Long Island MacArthur", latitude: 40.7952, longitude: -73.1002, importance: 1 },
  { iata: "TEB", icao: "KTEB", name: "Teterboro",           latitude: 40.8501, longitude: -74.0608, importance: 1 },
  { iata: "SWF", icao: "KSWF", name: "Stewart International", latitude: 41.5041, longitude: -74.1048, importance: 1 },

  // Regional GA fields — visible at high zoom only.
  { iata: "FRG", icao: "KFRG", name: "Republic",            latitude: 40.7288, longitude: -73.4134, importance: 0 },
  { iata: "FOK", icao: "KFOK", name: "Francis S. Gabreski", latitude: 40.8438, longitude: -72.6318, importance: 0 },
  { iata: "CDW", icao: "KCDW", name: "Essex County",        latitude: 40.8753, longitude: -74.2814, importance: 0 },
  { iata: "MMU", icao: "KMMU", name: "Morristown",          latitude: 40.7994, longitude: -74.4150, importance: 0 },
];
