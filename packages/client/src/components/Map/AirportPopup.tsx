import type { ReactNode } from "react";
import { Popup } from "react-map-gl/maplibre";
import type { Airport, FlightCategory, Frequencies, MetarReport, Runway } from "@panoptrain/shared";

/** Click-to-inspect airport briefing — frequencies + runways + elevation
 *  + current METAR weather. The same set a pilot looks up in the FAA
 *  Chart Supplement plus a glance-able weather row. Mirrors
 *  AircraftPopup's react-map-gl Popup pattern (airport position is static
 *  so no per-frame DOM repositioning needed). */
interface AirportPopupProps {
  airport: Airport;
  /** Current METAR observation, null if no report available (poller cold,
   *  ASOS outage, etc.). The popup omits the weather section entirely
   *  rather than rendering empty rows. */
  metar: MetarReport | null;
  onClose: () => void;
}

export function AirportPopup({ airport, metar, onClose }: AirportPopupProps) {
  return (
    <Popup
      className="airport-popup"
      longitude={airport.longitude}
      latitude={airport.latitude}
      anchor="bottom"
      offset={14}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="320px"
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.97)",
          color: "#e2e8f0",
          borderRadius: 6,
          padding: "10px 14px",
          minWidth: 260,
          fontSize: 12,
          lineHeight: 1.5,
          border: "1px solid rgba(148, 163, 184, 0.3)",
        }}
      >
        <Header airport={airport} metar={metar} onClose={onClose} />
        <StatsLine airport={airport} />
        {metar && <MetarSection metar={metar} />}
        <FrequenciesSection frequencies={airport.frequencies} />
        <RunwaysSection runways={airport.runways} />
      </div>
      {/* Scoped via the .airport-popup className on the Popup root so we
          don't unintentionally restyle other map popups (e.g. aircraft)
          while this one is open. */}
      <style>{`
        .airport-popup .maplibregl-popup-content {
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .airport-popup .maplibregl-popup-tip {
          border-top-color: rgba(15, 23, 42, 0.97) !important;
        }
      `}</style>
    </Popup>
  );
}

function Header({ airport, metar, onClose }: { airport: Airport; metar: MetarReport | null; onClose: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
      <div>
        {/* IATA is the recognizable handle ("JFK"); ICAO and full name are
            the formal identification underneath. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>{airport.iata}</div>
          {metar?.flightCategory && <FlightCategoryBadge category={metar.flightCategory} />}
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 12 }}>{airport.name}</div>
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          marginLeft: 8,
        }}
      >
        ×
      </button>
    </div>
  );
}

function StatsLine({ airport }: { airport: Airport }) {
  // ICAO + elevation + runway count on one line — the basic identifier
  // strip a pilot scans first when looking at any airport in a directory.
  const parts = [
    airport.icao,
    `${airport.elevation.toLocaleString("en-US")} ft MSL`,
    `${airport.runways.length} runway${airport.runways.length === 1 ? "" : "s"}`,
  ];
  return (
    <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
      {parts.join(" · ")}
    </div>
  );
}

/** Display labels for each frequency category. Some abbreviations (CTAF,
 *  ATIS, AWOS, UNICOM) are universal in aviation and don't need expansion. */
const FREQUENCY_ORDER: Array<[keyof Frequencies, string]> = [
  ["atis", "ATIS"],
  ["awos", "AWOS"],
  ["tower", "Tower"],
  ["ground", "Ground"],
  ["clearance", "Clearance"],
  ["approach", "Approach"],
  ["departure", "Departure"],
  ["ctaf", "CTAF"],
  ["unicom", "UNICOM"],
];

function FrequenciesSection({ frequencies }: { frequencies: Frequencies }) {
  // Skip the section entirely if no frequencies are listed (defensive —
  // every NYC airport has at least one, but the type allows zero).
  const present = FREQUENCY_ORDER.filter(([key]) => frequencies[key] && frequencies[key]!.length > 0);
  if (present.length === 0) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <SectionLabel>Frequencies</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        {present.map(([key, label]) => (
          <Row key={key} label={label} value={(frequencies[key] ?? []).join("  ")} />
        ))}
      </div>
    </div>
  );
}

function RunwaysSection({ runways }: { runways: readonly Runway[] }) {
  if (runways.length === 0) return null;
  return (
    <div>
      <SectionLabel>Runways</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {runways.map((rwy) => (
          <RunwayLine key={rwy.id} runway={rwy} />
        ))}
      </div>
    </div>
  );
}

function RunwayLine({ runway }: { runway: Runway }) {
  // Length right-aligned via tabular-nums + fixed width so multi-runway
  // lists scan vertically: "13R/31L · 14,511 ft · concrete · ILS".
  const parts = [
    runway.id,
    `${runway.lengthFt.toLocaleString("en-US")} ft`,
    runway.surface,
  ];
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontVariantNumeric: "tabular-nums" }}>
      <span style={{ color: "#cbd5e1" }}>{parts.join(" · ")}</span>
      {runway.ils && <span style={{ color: "#fef08a", fontWeight: 600, fontSize: 11 }}>ILS</span>}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontSize: 10,
        fontWeight: 700,
        color: "#94a3b8",
        marginBottom: 4,
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span style={{ color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </>
  );
}

/** FAA flight category color convention used by every flight-display in
 *  US aviation — green/blue/red/magenta. Matching this (rather than
 *  picking app-theme colors) so pilots get instant recognition. */
const FLIGHT_CATEGORY_COLOR: Record<FlightCategory, string> = {
  VFR: "#22c55e",   // green
  MVFR: "#3b82f6",  // blue
  IFR: "#ef4444",   // red
  LIFR: "#d946ef",  // magenta
};

function FlightCategoryBadge({ category }: { category: FlightCategory }) {
  return (
    <span
      style={{
        background: FLIGHT_CATEGORY_COLOR[category],
        color: "#0a0a1a",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "2px 6px",
        borderRadius: 3,
        lineHeight: 1,
      }}
    >
      {category}
    </span>
  );
}

function MetarSection({ metar }: { metar: MetarReport }) {
  const rows: Array<[string, string]> = [];
  if (metar.wind) {
    if (metar.wind.speedKt === 0) {
      // METAR "00000KT" = calm wind. Direction is meaningless when speed
      // is zero; aviation convention is to just say "Calm".
      rows.push(["Wind", "Calm"]);
    } else {
      const dir = metar.wind.directionDeg === null
        ? "VRB"
        : `${String(metar.wind.directionDeg).padStart(3, "0")}°`;
      const gust = metar.wind.gustKt !== null ? `G${metar.wind.gustKt}` : "";
      rows.push(["Wind", `${dir} @ ${metar.wind.speedKt}${gust} kt`]);
    }
  }
  if (metar.visibilitySm !== null) {
    rows.push(["Visibility", `${metar.visibilitySm} sm`]);
  }
  if (metar.ceilingFt !== null) {
    rows.push(["Ceiling", `${metar.ceilingFt.toLocaleString("en-US")} ft`]);
  }
  if (metar.tempC !== null) {
    const dew = metar.dewpointC !== null ? ` / ${Math.round(metar.dewpointC)}` : "";
    rows.push(["Temp / Dew", `${Math.round(metar.tempC)}${dew} °C`]);
  }
  if (metar.altimeterInHg !== null) {
    rows.push(["Altimeter", `${metar.altimeterInHg.toFixed(2)} inHg`]);
  }
  if (rows.length === 0) return null;

  // Observed-at relative time gives "as-of" without making the popup
  // recompute on every render. The observation is at most an hour old
  // and the user opens popups for seconds at a time, so a snapshot of
  // "X minutes ago" at render time is accurate enough.
  const ageMin = Math.max(0, Math.round((Date.now() - metar.observedAt) / 60_000));
  const observedLabel = ageMin === 0 ? "just now" : `${ageMin} min ago`;

  return (
    <div style={{ marginBottom: 8 }}>
      <SectionLabel>Weather · {observedLabel}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        {rows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}
