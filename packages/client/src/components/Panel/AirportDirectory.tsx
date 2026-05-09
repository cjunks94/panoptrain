import type { Airport, FlightCategory, MetarReport } from "@panoptrain/shared";
import { AIRPORTS } from "@panoptrain/shared";

/**
 * Vertical airport directory shown in the panel on the airspace tab —
 * the airspace equivalent of the trip planner. Pilots scanning a
 * specific field don't have to find its dot on the map; they pick
 * from the list and the map flies to it + opens the briefing popup.
 *
 * Grouped by importance (hubs / major / regional) so the visual
 * hierarchy mirrors the station-importance buckets used elsewhere.
 * The current flight category is shown as a small color-coded badge,
 * giving a fleet-wide weather glance without opening individual popups.
 */
interface AirportDirectoryProps {
  metarReports: Record<string, MetarReport>;
  /** ICAO of the currently popped airport, if any. Highlights the
   *  matching row so the directory state mirrors the map. */
  activeIata: string | null;
  onSelect: (iata: string) => void;
}

const GROUPS: Array<{ label: string; importance: 0 | 1 | 2 }> = [
  { label: "Hubs",     importance: 2 },
  { label: "Major",    importance: 1 },
  { label: "Regional", importance: 0 },
];

const FLIGHT_CATEGORY_COLOR: Record<FlightCategory, string> = {
  VFR: "#22c55e",
  MVFR: "#3b82f6",
  IFR: "#ef4444",
  LIFR: "#d946ef",
};

export function AirportDirectory({ metarReports, activeIata, onSelect }: AirportDirectoryProps) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      <p style={{ color: "#cbd5e1", fontSize: 12, lineHeight: 1.5, margin: "0 16px 12px" }}>
        Tap an airport for frequencies, runways, and current weather.
      </p>
      {GROUPS.map((group) => {
        const inGroup = AIRPORTS.filter((a) => a.importance === group.importance);
        if (inGroup.length === 0) return null;
        return (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontSize: 10,
                fontWeight: 700,
                color: "#94a3b8",
                padding: "4px 16px",
              }}
            >
              {group.label}
            </div>
            {inGroup.map((airport) => (
              <AirportRow
                key={airport.iata}
                airport={airport}
                metar={metarReports[airport.icao] ?? null}
                active={activeIata === airport.iata}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AirportRow({
  airport,
  metar,
  active,
  onSelect,
}: {
  airport: Airport;
  metar: MetarReport | null;
  active: boolean;
  onSelect: (iata: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(airport.iata)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        background: active ? "rgba(254, 240, 138, 0.08)" : "transparent",
        border: "none",
        borderLeft: active ? "3px solid #fef08a" : "3px solid transparent",
        color: "#e2e8f0",
        textAlign: "left",
        cursor: "pointer",
        // 44px effective touch target (10+10 padding + ~20 line-height).
        minHeight: 44,
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#fff",
          minWidth: 36,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {airport.iata}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: "#cbd5e1",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {airport.name}
      </span>
      {metar?.flightCategory && (
        <span
          style={{
            background: FLIGHT_CATEGORY_COLOR[metar.flightCategory],
            color: "#0a0a1a",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "2px 5px",
            borderRadius: 3,
            lineHeight: 1,
          }}
        >
          {metar.flightCategory}
        </span>
      )}
    </button>
  );
}
