/** NYC-metro airport markers + briefings rendered on the airspace view.
 *  Hardcoded because the list is small, static, and doesn't merit a server
 *  endpoint until enrichment (live ops counts, ETA aggregates) shows up.
 *
 *  Importance buckets mirror the transit station convention (see
 *  stationImportance in server/src/routes/static.ts):
 *    2 = hub      — major commercial gateway, shown earliest, largest dot
 *    1 = major    — secondary commercial / large GA, shown at mid zoom
 *    0 = regional — smaller GA fields, only labeled at high zoom
 *
 *  Frequencies + runway data sourced from airnav.com (which mirrors the
 *  FAA Chart Supplement). Should be re-verified before being relied on
 *  for actual flight ops — chart supplements update every 56 days and
 *  frequencies do change. The popup is for situational awareness, not
 *  primary navigation.
 */

export type RunwaySurface = "asphalt" | "concrete" | "asphalt/concrete" | "turf";

export interface Runway {
  /** Pair designation, e.g. "13L/31R", "04/22". */
  id: string;
  lengthFt: number;
  surface: RunwaySurface;
  /** True if at least one end has a published ILS approach. */
  ils: boolean;
}

/** Each category is optional — non-towered fields lack tower/ground/clearance,
 *  uncontrolled fields lack approach/departure, etc. Multiple values per
 *  category are common (LGA has separate ATIS for arrival vs departure). */
export interface Frequencies {
  atis?: readonly string[];
  awos?: readonly string[];
  tower?: readonly string[];
  ground?: readonly string[];
  clearance?: readonly string[];
  approach?: readonly string[];
  departure?: readonly string[];
  ctaf?: readonly string[];
  unicom?: readonly string[];
}

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  latitude: number;
  longitude: number;
  importance: 0 | 1 | 2;
  /** Field elevation in feet MSL, rounded to integer. */
  elevation: number;
  runways: readonly Runway[];
  frequencies: Frequencies;
}

export const AIRPORTS: readonly Airport[] = [
  // --- Hubs — the big three NYC commercial gateways. ---
  {
    iata: "JFK", icao: "KJFK", name: "John F. Kennedy",
    latitude: 40.6413, longitude: -73.7781, importance: 2,
    elevation: 13,
    runways: [
      { id: "13R/31L", lengthFt: 14511, surface: "concrete",         ils: true },
      { id: "04L/22R", lengthFt: 12079, surface: "concrete",         ils: true },
      { id: "13L/31R", lengthFt: 10000, surface: "concrete",         ils: true },
      { id: "04R/22L", lengthFt:  8400, surface: "asphalt",          ils: true },
    ],
    frequencies: {
      atis:      ["115.4", "117.7", "128.725"],
      tower:     ["119.1", "123.9"],
      ground:    ["121.9", "121.65"],
      clearance: ["135.05"],
      approach:  ["125.7", "128.125", "118.4", "123.7", "126.8", "132.4", "134.35"],
      departure: ["135.9", "123.7", "124.75", "134.35"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "LGA", icao: "KLGA", name: "LaGuardia",
    latitude: 40.7769, longitude: -73.8740, importance: 2,
    elevation: 21,
    runways: [
      { id: "04/22", lengthFt: 7002, surface: "asphalt/concrete", ils: true },
      { id: "13/31", lengthFt: 7002, surface: "asphalt/concrete", ils: true },
    ],
    frequencies: {
      atis:      ["125.95", "127.05"],
      tower:     ["118.7"],
      ground:    ["121.7", "121.85", "127.675"],
      clearance: ["121.875", "135.2"],
      approach:  ["120.8", "120.05", "124.95", "127.3", "128.8", "132.7"],
      departure: ["120.4", "124.45", "127.05"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "EWR", icao: "KEWR", name: "Newark Liberty",
    latitude: 40.6925, longitude: -74.1687, importance: 2,
    elevation: 18,
    runways: [
      { id: "04L/22R", lengthFt: 11000, surface: "asphalt/concrete", ils: true },
      { id: "04R/22L", lengthFt:  9999, surface: "asphalt",          ils: true },
      { id: "11/29",   lengthFt:  6725, surface: "asphalt",          ils: true },
    ],
    frequencies: {
      atis:      ["115.7", "134.825"],
      tower:     ["118.3"],
      ground:    ["121.8", "126.15"],
      clearance: ["118.85"],
      approach:  ["127.6", "128.55", "132.7", "132.8"],
      departure: ["119.2"],
      unicom:    ["122.95"],
    },
  },

  // --- Major secondaries — commercial service or heavy GA / corporate. ---
  {
    iata: "HPN", icao: "KHPN", name: "Westchester County",
    latitude: 41.0670, longitude: -73.7076, importance: 1,
    elevation: 439,
    runways: [
      { id: "16/34", lengthFt: 6549, surface: "asphalt", ils: true  },
      { id: "11/29", lengthFt: 4451, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["133.8"],
      tower:     ["118.575"],
      ground:    ["121.825"],
      clearance: ["126.4", "127.25"],
      approach:  ["120.8", "126.4"],
      departure: ["120.55"],
      ctaf:      ["118.575"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "ISP", icao: "KISP", name: "Long Island MacArthur",
    latitude: 40.7952, longitude: -73.1002, importance: 1,
    elevation: 99,
    runways: [
      { id: "06/24",   lengthFt: 7006, surface: "asphalt", ils: true  },
      { id: "15R/33L", lengthFt: 5186, surface: "asphalt", ils: false },
      { id: "15L/33R", lengthFt: 3175, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["120.725"],
      awos:      ["120.725"],
      tower:     ["119.3", "124.3"],
      ground:    ["135.3"],
      clearance: ["121.85"],
      approach:  ["120.05"],
      departure: ["120.05"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "TEB", icao: "KTEB", name: "Teterboro",
    latitude: 40.8501, longitude: -74.0608, importance: 1,
    elevation: 8,
    runways: [
      { id: "01/19", lengthFt: 6997, surface: "asphalt", ils: true },
      { id: "06/24", lengthFt: 6014, surface: "asphalt", ils: true },
    ],
    frequencies: {
      atis:      ["114.2", "132.85"],
      tower:     ["119.5", "125.1"],
      ground:    ["121.9"],
      clearance: ["128.05"],
      approach:  ["127.6"],
      departure: ["119.2", "126.7"],
    },
  },
  {
    iata: "SWF", icao: "KSWF", name: "Stewart International",
    latitude: 41.5041, longitude: -74.1048, importance: 1,
    elevation: 491,
    runways: [
      { id: "09/27", lengthFt: 11817, surface: "asphalt", ils: true  },
      { id: "16/34", lengthFt:  6004, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["124.575"],
      tower:     ["121.0"],
      ground:    ["121.9"],
      approach:  ["132.75"],
      departure: ["132.75"],
      unicom:    ["122.95"],
    },
  },

  // --- Regional GA fields. Most have part-time towers (CTAF kicks in
  //     after-hours), and approach/departure are handled by NY or Newark. ---
  {
    iata: "FRG", icao: "KFRG", name: "Republic",
    latitude: 40.7288, longitude: -73.4134, importance: 0,
    elevation: 82,
    runways: [
      { id: "14/32", lengthFt: 6833, surface: "asphalt", ils: true  },
      { id: "01/19", lengthFt: 5517, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["126.65"],
      tower:     ["118.8", "125.2"],
      ground:    ["121.6"],
      clearance: ["128.25"],
      approach:  ["128.125", "118.4", "123.7", "132.4", "134.35"],
      departure: ["125.7", "123.7", "134.35"],
      ctaf:      ["118.8"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "FOK", icao: "KFOK", name: "Francis S. Gabreski",
    latitude: 40.8438, longitude: -72.6318, importance: 0,
    elevation: 66,
    runways: [
      { id: "06/24", lengthFt: 9002, surface: "asphalt/concrete", ils: true  },
      { id: "15/33", lengthFt: 5002, surface: "asphalt",          ils: false },
      { id: "01/19", lengthFt: 5100, surface: "asphalt/concrete", ils: false },
    ],
    frequencies: {
      awos:      ["119.925"],
      tower:     ["125.3"],
      ground:    ["121.8"],
      approach:  ["125.975"],
      departure: ["125.975"],
      ctaf:      ["125.3"],
    },
  },
  {
    iata: "CDW", icao: "KCDW", name: "Essex County",
    latitude: 40.8753, longitude: -74.2814, importance: 0,
    elevation: 172,
    runways: [
      { id: "04/22", lengthFt: 4552, surface: "asphalt", ils: true  },
      { id: "10/28", lengthFt: 3719, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["135.5"],
      awos:      ["135.5"],
      tower:     ["119.8"],
      ground:    ["121.9"],
      clearance: ["121.1"],
      approach:  ["127.6"],
      departure: ["119.2"],
      ctaf:      ["119.8"],
      unicom:    ["122.95"],
    },
  },
  {
    iata: "MMU", icao: "KMMU", name: "Morristown",
    latitude: 40.7994, longitude: -74.4150, importance: 0,
    elevation: 187,
    runways: [
      { id: "05/23", lengthFt: 5998, surface: "asphalt", ils: true  },
      { id: "13/31", lengthFt: 3997, surface: "asphalt", ils: false },
    ],
    frequencies: {
      atis:      ["124.25"],
      tower:     ["118.1"],
      ground:    ["134.2"],
      clearance: ["128.6"],
      approach:  ["127.6"],
      departure: ["119.2"],
      ctaf:      ["118.1"],
    },
  },
];
