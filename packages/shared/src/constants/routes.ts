export interface RouteInfo {
  routeId: string;
  name: string;
  color: string;
  textColor: string;
  group: string;
  isExpress: boolean;
}

/** Official MTA route colors and metadata */
export const ROUTE_INFO: Record<string, RouteInfo> = {
  "1": { routeId: "1", name: "1", color: "#EE352E", textColor: "#FFFFFF", group: "123", isExpress: false },
  "2": { routeId: "2", name: "2", color: "#EE352E", textColor: "#FFFFFF", group: "123", isExpress: true },
  "3": { routeId: "3", name: "3", color: "#EE352E", textColor: "#FFFFFF", group: "123", isExpress: true },
  "4": { routeId: "4", name: "4", color: "#00933C", textColor: "#FFFFFF", group: "456", isExpress: true },
  "5": { routeId: "5", name: "5", color: "#00933C", textColor: "#FFFFFF", group: "456", isExpress: true },
  "6": { routeId: "6", name: "6", color: "#00933C", textColor: "#FFFFFF", group: "456", isExpress: false },
  "6X": { routeId: "6X", name: "6X", color: "#00933C", textColor: "#FFFFFF", group: "456", isExpress: true },
  "7": { routeId: "7", name: "7", color: "#B933AD", textColor: "#FFFFFF", group: "7", isExpress: false },
  "7X": { routeId: "7X", name: "7X", color: "#B933AD", textColor: "#FFFFFF", group: "7", isExpress: true },
  A: { routeId: "A", name: "A", color: "#0039A6", textColor: "#FFFFFF", group: "ACE", isExpress: true },
  C: { routeId: "C", name: "C", color: "#0039A6", textColor: "#FFFFFF", group: "ACE", isExpress: false },
  E: { routeId: "E", name: "E", color: "#0039A6", textColor: "#FFFFFF", group: "ACE", isExpress: false },
  B: { routeId: "B", name: "B", color: "#FF6319", textColor: "#FFFFFF", group: "BDFM", isExpress: true },
  D: { routeId: "D", name: "D", color: "#FF6319", textColor: "#FFFFFF", group: "BDFM", isExpress: true },
  F: { routeId: "F", name: "F", color: "#FF6319", textColor: "#FFFFFF", group: "BDFM", isExpress: false },
  FX: { routeId: "FX", name: "FX", color: "#FF6319", textColor: "#FFFFFF", group: "BDFM", isExpress: true },
  M: { routeId: "M", name: "M", color: "#FF6319", textColor: "#FFFFFF", group: "BDFM", isExpress: false },
  G: { routeId: "G", name: "G", color: "#6CBE45", textColor: "#FFFFFF", group: "G", isExpress: false },
  J: { routeId: "J", name: "J", color: "#996633", textColor: "#FFFFFF", group: "JZ", isExpress: false },
  Z: { routeId: "Z", name: "Z", color: "#996633", textColor: "#FFFFFF", group: "JZ", isExpress: false },
  L: { routeId: "L", name: "L", color: "#A7A9AC", textColor: "#FFFFFF", group: "L", isExpress: false },
  N: { routeId: "N", name: "N", color: "#FCCC0A", textColor: "#1D1D1B", group: "NQRW", isExpress: true },
  Q: { routeId: "Q", name: "Q", color: "#FCCC0A", textColor: "#1D1D1B", group: "NQRW", isExpress: true },
  R: { routeId: "R", name: "R", color: "#FCCC0A", textColor: "#1D1D1B", group: "NQRW", isExpress: false },
  W: { routeId: "W", name: "W", color: "#FCCC0A", textColor: "#1D1D1B", group: "NQRW", isExpress: false },
  GS: { routeId: "GS", name: "S 42nd", color: "#808183", textColor: "#FFFFFF", group: "S", isExpress: false },
  FS: { routeId: "FS", name: "S Franklin", color: "#808183", textColor: "#FFFFFF", group: "S", isExpress: false },
  H: { routeId: "H", name: "S Rockaway", color: "#808183", textColor: "#FFFFFF", group: "S", isExpress: false },
  SI: { routeId: "SI", name: "SIR", color: "#0039A6", textColor: "#FFFFFF", group: "SIR", isExpress: false },
};

/** All unique route IDs */
export const ALL_ROUTE_IDS = Object.keys(ROUTE_INFO);

/** Route groups for the filter panel */
export const ROUTE_GROUPS = [
  { label: "1 2 3", routes: ["1", "2", "3"], color: "#EE352E" },
  { label: "4 5 6", routes: ["4", "5", "6", "6X"], color: "#00933C" },
  { label: "7", routes: ["7", "7X"], color: "#B933AD" },
  { label: "A C E", routes: ["A", "C", "E"], color: "#0039A6" },
  { label: "B D F M", routes: ["B", "D", "F", "FX", "M"], color: "#FF6319" },
  { label: "G", routes: ["G"], color: "#6CBE45" },
  { label: "J Z", routes: ["J", "Z"], color: "#996633" },
  { label: "L", routes: ["L"], color: "#A7A9AC" },
  { label: "N Q R W", routes: ["N", "Q", "R", "W"], color: "#FCCC0A" },
  { label: "S", routes: ["GS", "FS", "H"], color: "#808183" },
  { label: "SIR", routes: ["SI"], color: "#0039A6" },
] as const;
