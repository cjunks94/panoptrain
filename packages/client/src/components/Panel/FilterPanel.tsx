import { ROUTE_GROUPS } from "@panoptrain/shared";
import type { StopsGeoJSON, TripPlan } from "@panoptrain/shared";
import { LineToggle } from "./LineToggle.js";
import { TripPlanner } from "./TripPlanner.js";
import { StatusBadge } from "../Layout/StatusBadge.js";

interface FilterPanelProps {
  open: boolean;
  onToggle: () => void;
  visibleRoutes: Set<string>;
  onToggleRoute: (routeId: string) => void;
  onToggleGroup: (groupLabel: string) => void;
  onAllOn: () => void;
  onAllOff: () => void;
  isStale: boolean;
  lastUpdated: number | null;
  trainCount: number;
  stops: StopsGeoJSON | null;
  onPlanFound?: (plan: TripPlan | null) => void;
}

export function FilterPanel({
  open,
  onToggle,
  visibleRoutes,
  onToggleGroup,
  onAllOn,
  onAllOff,
  isStale,
  trainCount,
  stops,
  onPlanFound,
}: FilterPanelProps) {
  return (
    <>
      {/* Toggle button when panel is closed */}
      {!open && (
        <button
          onClick={onToggle}
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 10,
            background: "rgba(26, 26, 46, 0.9)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#e0e0e0",
            padding: "8px 12px",
            cursor: "pointer",
            fontSize: 14,
            backdropFilter: "blur(8px)",
          }}
        >
          Filter Lines
        </button>
      )}

      {/* Panel */}
      <div
        style={{
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
        }}
      >
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
                fontSize: 18,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge isStale={isStale} trainCount={trainCount} />
          </div>
        </div>

        {/* Trip planner */}
        <TripPlanner stops={stops} onPlanFound={onPlanFound} />

        {/* Quick actions */}
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

        {/* Line groups */}
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
      </div>
    </>
  );
}

const quickBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "6px 0",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};
