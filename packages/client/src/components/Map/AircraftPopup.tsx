import { forwardRef } from "react";
import type { Aircraft } from "@panoptrain/shared";
import {
  displayCallsign,
  formatAltitude,
  formatGroundSpeed,
  formatTrack,
} from "../../lib/aircraftFormat.js";

interface AircraftPopupProps {
  aircraft: Aircraft;
  onClose: () => void;
}

/** Click-to-inspect popup for an aircraft. Positioned each RAF tick via
 *  direct DOM mutation in TransitMap (no React render per frame); content
 *  React-renders only when the underlying Aircraft data changes per poll
 *  (~8s). Mirrors the TrainPopup pattern so the popup tracks the dead-
 *  reckoned marker instead of lagging up to ~1.5s during snap-back, which
 *  it did under react-map-gl's `<Popup>` (re-rendered only on poll-snap
 *  position changes).
 *
 *  Translucent dark background so the card blends with the dark basemap.
 *  Initial off-screen position is overridden on the first RAF tick by
 *  positionPopupOverlay in TransitMap. */
export const AircraftPopup = forwardRef<HTMLDivElement, AircraftPopupProps>(
  function AircraftPopup({ aircraft, onClose }, ref) {
    const title = displayCallsign(aircraft);
    const isEmergency =
      aircraft.squawk === "7500" ||
      aircraft.squawk === "7600" ||
      aircraft.squawk === "7700";

    return (
      <div
        ref={ref}
        role="dialog"
        aria-label={`Aircraft ${title} info`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          // Initial off-screen position; RAF overrides on first tick.
          transform: "translate(-9999px, -9999px)",
          zIndex: 5,
          minWidth: 160,
          maxWidth: 220,
          padding: "8px 12px",
          borderRadius: 6,
          background: "rgba(15, 23, 42, 0.95)",
          color: "#e2e8f0",
          fontSize: 12,
          lineHeight: 1.5,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
          border: `1px solid ${isEmergency ? "#ef4444" : "rgba(148, 163, 184, 0.3)"}`,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <strong style={{ fontSize: 13, color: "#fff" }}>{title}</strong>
          {/* 44×44 hit area meets the project's mobile touch-target standard;
              negative margin pulls the button into the popup's padding so
              the popup doesn't grow to accommodate the larger button. */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              minWidth: 44,
              minHeight: 44,
              margin: "-8px -12px -8px 0",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
        <Row label="Altitude" value={formatAltitude(aircraft.altBaro)} />
        <Row label="Speed" value={formatGroundSpeed(aircraft.groundSpeed)} />
        <Row label="Heading" value={formatTrack(aircraft.track)} />
        {aircraft.squawk && (
          <Row
            label="Squawk"
            value={aircraft.squawk}
            valueColor={isEmergency ? "#fca5a5" : undefined}
          />
        )}
      </div>
    );
  },
);

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span
        style={{
          color: valueColor ?? "#e2e8f0",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
