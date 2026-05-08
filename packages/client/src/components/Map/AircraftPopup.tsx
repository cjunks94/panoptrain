import { Popup } from "react-map-gl/maplibre";
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

/** Click-to-inspect popup for an aircraft. Uses react-map-gl's Popup for
 *  positioning rather than the custom DOM-pinning overlay TrainPopup uses
 *  — aircraft don't need per-frame interpolation, and the snap-each-poll
 *  motion is already legible as movement. Default Popup styling is light
 *  on a white background; we override via CSS-in-JS to match the dark
 *  theme of the rest of the UI. */
export function AircraftPopup({ aircraft, onClose }: AircraftPopupProps) {
  const title = displayCallsign(aircraft);
  const isEmergency = aircraft.squawk === "7500" || aircraft.squawk === "7600" || aircraft.squawk === "7700";

  return (
    <Popup
      longitude={aircraft.longitude}
      latitude={aircraft.latitude}
      anchor="bottom"
      offset={12}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="220px"
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.95)",
          color: "#e2e8f0",
          borderRadius: 6,
          padding: "8px 12px",
          minWidth: 160,
          fontSize: 12,
          lineHeight: 1.5,
          border: `1px solid ${isEmergency ? "#ef4444" : "rgba(148, 163, 184, 0.3)"}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <strong style={{ fontSize: 13, color: "#fff" }}>{title}</strong>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              marginLeft: 8,
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
      <style>{`
        .maplibregl-popup-content {
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .maplibregl-popup-tip {
          border-top-color: rgba(15, 23, 42, 0.95) !important;
        }
      `}</style>
    </Popup>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: "#94a3b8" }}>{label}</span>
      <span style={{ color: valueColor ?? "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}
