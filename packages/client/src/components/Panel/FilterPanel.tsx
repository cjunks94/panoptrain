import { useEffect, useState } from "react";
import { ROUTE_GROUPS } from "@panoptrain/shared";
import type { Mode, StopsGeoJSON, TripPlan, TrainPosition } from "@panoptrain/shared";
import { LineToggle } from "./LineToggle.js";
import { TripPlanner } from "./TripPlanner.js";
import { ModeTabs } from "./ModeTabs.js";
import { StatusBadge } from "../Layout/StatusBadge.js";

const MOBILE_QUERY = "(max-width: 767px)";

/** Reactive viewport check — flips if the user rotates a tablet or resizes
 *  desktop down to mobile widths. SSR-safe: returns false until mount. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

interface FilterPanelProps {
  open: boolean;
  onToggle: () => void;
  mode: Mode;
  onModeChange: (next: Mode) => void;
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
  onPlanFound?: (plan: TripPlan | null) => void;
}

export function FilterPanel({
  open,
  onToggle,
  mode,
  onModeChange,
  visibleRoutes,
  onToggleGroup,
  onAllOn,
  onAllOff,
  isStale,
  trainCount,
  stops,
  liveTrains,
  onPlanFound,
}: FilterPanelProps) {
  const isMobile = useIsMobile();

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
          Filter Lines
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
            <StatusBadge isStale={isStale} trainCount={trainCount} />
          </div>
        </div>

        {/* Mode tabs (PT-504) */}
        <ModeTabs mode={mode} onChange={onModeChange} />

        {/* Trip planner is subway-only for now (PT-508). LIRR is schedule-based
            with peak/off-peak fares — its own future epic. */}
        {mode === "subway" ? (
          <TripPlanner stops={stops} liveTrains={liveTrains} onPlanFound={onPlanFound} />
        ) : (
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              fontSize: 11,
              color: "#888",
              fontStyle: "italic",
            }}
          >
            Trip planning is subway-only for now. LIRR planning coming in a future release.
          </div>
        )}

        {/* Quick actions + line groups are subway-only (ROUTE_GROUPS lists
            subway lines). PT-506 will introduce LIRR_ROUTE_GROUPS. */}
        {mode === "subway" && (
          <>
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
              {ROUTE_GROUPS.map((group) => {
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
        )}
        {mode === "lirr" && (
          // Spacer; route filters are subway-only until PT-506 ships LIRR groups.
          <div style={{ flex: 1 }} />
        )}
      </div>
    </>
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
