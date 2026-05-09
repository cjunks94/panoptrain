import { routeGroupsForMode } from "@panoptrain/shared";
import type {
  MetarReport,
  Mode,
  StopsGeoJSON,
  TripPlan,
  LirrTripPlan,
  TrainPosition,
} from "@panoptrain/shared";
import { LineToggle } from "./LineToggle.js";
import { TripPlanner } from "./TripPlanner.js";
import { LirrTripPlanner } from "./LirrTripPlanner.js";
import { ModeTabs } from "./ModeTabs.js";
import { AirportDirectory } from "./AirportDirectory.js";
import { StatusBadge } from "../Layout/StatusBadge.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import type { View } from "../../hooks/useView.js";

interface FilterPanelProps {
  open: boolean;
  onToggle: () => void;
  view: View;
  /** The current transit mode if `view` is subway or LIRR; null when on
   *  airspace. Mode-specific subsections (line filters, trip planner)
   *  consume this directly so they don't need to recompute the narrowing. */
  transitMode: Mode | null;
  onViewChange: (next: View) => void;
  visibleRoutes: Set<string>;
  onToggleRoute: (routeId: string) => void;
  onToggleGroup: (groupLabel: string) => void;
  onAllOn: () => void;
  onAllOff: () => void;
  isStale: boolean;
  lastUpdated: number | null;
  trainCount: number;
  stops: StopsGeoJSON | null;
  liveTrains: TrainPosition[];
  onPlanFound?: (plan: TripPlan | LirrTripPlan | null) => void;
  /** Aircraft snapshot count — surfaced as the airspace view's status. */
  aircraftCount: number;
  /** METAR observations keyed by ICAO. The airport directory uses these
   *  to render a flight-category badge per airport. */
  metarReports: Record<string, MetarReport>;
  /** ICAO of the currently popped airport, if any. The directory
   *  highlights the matching row so the panel mirrors map state. */
  activeAirportIata: string | null;
  /** Called when the user picks an airport from the directory. Wired
   *  through App so the popup opens AND the camera flies to the airport. */
  onSelectAirport: (iata: string) => void;
}

export function FilterPanel({
  open,
  onToggle,
  view,
  transitMode,
  onViewChange,
  visibleRoutes,
  onToggleGroup,
  onAllOn,
  onAllOff,
  isStale,
  trainCount,
  stops,
  liveTrains,
  onPlanFound,
  aircraftCount,
  metarReports,
  activeAirportIata,
  onSelectAirport,
}: FilterPanelProps) {
  const isMobile = useIsMobile();
  const isAirspace = view === "airspace";

  // Below 768px the panel becomes a bottom sheet (full width × 75vh) so the
  // map keeps its full horizontal footprint instead of being squeezed by a
  // 260px sidebar that would eat ~67% of an iPhone 14 viewport (PT-402).
  // The closed state slides off-screen in the appropriate direction.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "absolute",
        bottom: open ? 0 : "-100%",
        left: 0,
        right: 0,
        height: "75vh",
        background: "rgba(26, 26, 46, 0.97)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        backdropFilter: "blur(12px)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        transition: "bottom 0.25s ease",
        overflow: "hidden",
      }
    : {
        position: "absolute",
        top: 0,
        left: open ? 0 : -280,
        width: 260,
        height: "100%",
        background: "rgba(26, 26, 46, 0.95)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(12px)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        transition: "left 0.2s ease",
        overflow: "hidden",
      };

  // Toggle button when panel is closed — top-left on desktop, bottom-center
  // on mobile so users tap toward the sheet's natural origin.
  const toggleStyle: React.CSSProperties = isMobile
    ? {
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        background: "rgba(26, 26, 46, 0.9)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 22,
        color: "#e0e0e0",
        padding: "0 20px",
        height: 44,
        boxSizing: "border-box",
        cursor: "pointer",
        fontSize: 14,
        backdropFilter: "blur(8px)",
      }
    : {
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 10,
        background: "rgba(26, 26, 46, 0.9)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        color: "#e0e0e0",
        padding: "0 16px",
        minHeight: 44,
        cursor: "pointer",
        fontSize: 14,
        backdropFilter: "blur(8px)",
      };

  return (
    <>
      {!open && (
        <button onClick={onToggle} style={toggleStyle}>
          {isAirspace ? "Airspace" : "Filter Lines"}
        </button>
      )}

      {/* Panel */}
      <div style={panelStyle}>
        {/* Header */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>Panoptrain</h1>
            <button
              onClick={onToggle}
              style={{
                background: "none",
                border: "none",
                color: "#999",
                cursor: "pointer",
                fontSize: 22,
                lineHeight: 1,
                width: 44,
                height: 44,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginRight: -8, // visually re-anchor without shrinking the tap target
              }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            {isAirspace ? (
              <AirspaceStatusBadge count={aircraftCount} />
            ) : (
              <StatusBadge isStale={isStale} trainCount={trainCount} />
            )}
          </div>
        </div>

        {/* View tabs */}
        <ModeTabs view={view} onChange={onViewChange} />

        {/* Transit-mode-specific UI (trip planner, route groups, line filter)
            is hidden on the airspace view since none of it applies. */}
        {transitMode !== null ? (
          <>
            {transitMode === "subway" ? (
              <TripPlanner stops={stops} liveTrains={liveTrains} onPlanFound={onPlanFound} />
            ) : (
              <LirrTripPlanner stops={stops} onPlanFound={onPlanFound} />
            )}

            <div
              style={{
                padding: "8px 16px",
                display: "flex",
                gap: 8,
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <button onClick={onAllOn} style={quickBtnStyle}>
                All On
              </button>
              <button onClick={onAllOff} style={quickBtnStyle}>
                All Off
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {routeGroupsForMode(transitMode).map((group) => {
                const allVisible = group.routes.every((r) => visibleRoutes.has(r));
                const someVisible = group.routes.some((r) => visibleRoutes.has(r));
                return (
                  <LineToggle
                    key={group.label}
                    label={group.label}
                    color={group.color}
                    active={allVisible}
                    partial={someVisible && !allVisible}
                    onToggle={() => onToggleGroup(group.label)}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <AirspacePanelBody
            count={aircraftCount}
            metarReports={metarReports}
            activeAirportIata={activeAirportIata}
            onSelectAirport={onSelectAirport}
          />
        )}
      </div>
    </>
  );
}

/** Body shown when the airspace tab is active. Replaces the previous
 *  prose-and-count placeholder with a clickable airport directory so a
 *  pilot can pick a field directly instead of hunting for its dot on
 *  the map. The aircraft count + ODbL attribution stay below the
 *  directory — aircraft layer is always on with this view selected,
 *  so there are no per-aircraft filters yet. */
function AirspacePanelBody({
  count,
  metarReports,
  activeAirportIata,
  onSelectAirport,
}: {
  count: number;
  metarReports: Record<string, MetarReport>;
  activeAirportIata: string | null;
  onSelectAirport: (iata: string) => void;
}) {
  return (
    <>
      <AirportDirectory
        metarReports={metarReports}
        activeIata={activeAirportIata}
        onSelect={onSelectAirport}
      />
      <div
        style={{
          padding: "8px 16px 12px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4 }}>
          {count > 0
            ? `${count} aircraft in view · refreshes every 8s.`
            : "No aircraft in view yet — refreshes every 8s."}
        </div>
        <div style={{ fontSize: 10, color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
          Aircraft:{" "}
          <a
            href="https://adsb.lol"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#94a3b8", textDecoration: "underline" }}
          >
            adsb.lol
          </a>{" "}
          (ODbL) · Weather:{" "}
          <a
            href="https://aviationweather.gov"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#94a3b8", textDecoration: "underline" }}
          >
            aviationweather.gov
          </a>
        </div>
      </div>
    </>
  );
}

/** Lightweight badge for the airspace view's header — replaces the
 *  StatusBadge's stale/live indicator with a simple aircraft count, since
 *  the upstream live/stale concept doesn't translate cleanly. */
function AirspaceStatusBadge({ count }: { count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 20,
        background: "rgba(148, 163, 184, 0.18)",
        border: "1px solid rgba(148, 163, 184, 0.35)",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#fef08a",
        }}
      />
      <span style={{ color: "#e2e8f0" }}>Airspace</span>
      <span style={{ color: "#999", fontVariantNumeric: "tabular-nums" }}>
        {count} aircraft
      </span>
    </div>
  );
}

const quickBtnStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 44,
  padding: "0 12px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};
