import { useState } from "react";
import type { Airport, MetarReport, TafReport } from "@panoptrain/shared";
import {
  FlightCategoryBadge,
  FrequenciesSection,
  MetarSection,
  RunwaysSection,
  StatsLine,
  TafSection,
} from "../Map/AirportPopup.js";

/**
 * Inline airport briefing for the mobile bottom sheet — replaces the
 * floating map popup on small screens. Renders at the top of the
 * AirportDirectory list when an airport is selected; collapsible
 * header lets the pilot tuck the (tall) detail body away to scan
 * the rest of the directory and pick another field.
 *
 * Reuses the section components from AirportPopup verbatim — the only
 * shape difference is the wrapper chrome (collapsible header + close
 * button instead of a maplibre Popup tip).
 */
interface AirportBriefingProps {
  airport: Airport;
  metar: MetarReport | null;
  taf: TafReport | null;
  onClose: () => void;
}

export function AirportBriefing({ airport, metar, taf, onClose }: AirportBriefingProps) {
  // Default expanded so the pilot sees the briefing immediately on
  // selection. Collapse-to-header lets them browse the directory list
  // without losing the current selection.
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.6)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
        // Subtle inset so the card visually pops out of the directory
        // list below it without breaking the panel's visual rhythm.
        boxShadow: "inset 0 -1px 0 rgba(255, 255, 255, 0.04)",
      }}
    >
      <Header
        airport={airport}
        metar={metar}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
        onClose={onClose}
      />
      {expanded && (
        <div style={{ padding: "8px 16px 12px", color: "#e2e8f0", fontSize: 12, lineHeight: 1.5 }}>
          <StatsLine airport={airport} />
          {metar && <MetarSection metar={metar} />}
          {taf && <TafSection taf={taf} />}
          <FrequenciesSection frequencies={airport.frequencies} />
          <RunwaysSection runways={airport.runways} />
        </div>
      )}
    </div>
  );
}

function Header({
  airport,
  metar,
  expanded,
  onToggle,
  onClose,
}: {
  airport: Airport;
  metar: MetarReport | null;
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", borderBottom: expanded ? "1px solid rgba(148, 163, 184, 0.15)" : "none" }}>
      {/* The header is the toggle target — large tap area for collapse/
          expand. Close button is separate so the pilot can dismiss the
          briefing without a second tap to expand it first. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${airport.iata} briefing — ${expanded ? "collapse" : "expand"}`}
        style={{
          flex: 1,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 0 10px 16px",
          background: "none",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <Chevron expanded={expanded} />
        <strong style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.1 }}>
          {airport.iata}
        </strong>
        <span style={{ color: "#94a3b8", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {airport.icao}
        </span>
        {metar?.flightCategory && <FlightCategoryBadge category={metar.flightCategory} />}
        <span
          style={{
            color: "#cbd5e1",
            fontSize: 12,
            marginLeft: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {airport.name}
        </span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close airport briefing"
        style={{
          minWidth: 44,
          minHeight: 44,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 20,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  // CSS rotation rather than swapping glyphs so the icon visibly
  // animates between states (transition handled by the inline style).
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 120ms ease-out",
        flexShrink: 0,
        color: "#94a3b8",
      }}
      aria-hidden="true"
    >
      <polygon points="1,3 9,3 5,8" fill="currentColor" />
    </svg>
  );
}
