import { useState, useMemo, useId } from "react";
import type { StopsGeoJSON, TripPlan } from "@panoptrain/shared";
import { fetchPlan } from "../../lib/api.js";
import { getRouteInfo } from "../../lib/colors.js";

interface TripPlannerProps {
  stops: StopsGeoJSON | null;
}

export function TripPlanner({ stops }: TripPlannerProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromListId = useId();
  const toListId = useId();

  // Map station name -> stopId. NYC has some duplicate names across boroughs;
  // the first match wins for v1.
  const nameToId = useMemo(() => {
    const map = new Map<string, string>();
    if (!stops) return map;
    for (const f of stops.features) {
      const name = f.properties.stopName;
      if (!map.has(name)) map.set(name, f.properties.stopId);
    }
    return map;
  }, [stops]);

  const stationNames = useMemo(() => Array.from(nameToId.keys()).sort(), [nameToId]);

  const handlePlan = async () => {
    setError(null);
    setPlan(null);
    const fromId = nameToId.get(from);
    const toId = nameToId.get(to);
    if (!fromId || !toId) {
      setError("Pick stations from the dropdown");
      return;
    }
    if (fromId === toId) {
      setError("Pick two different stations");
      return;
    }
    setLoading(true);
    try {
      const result = await fetchPlan(fromId, toId);
      setPlan(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#888", marginBottom: 8 }}>
        PLAN TRIP
      </div>

      <datalist id={fromListId}>
        {stationNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      <datalist id={toListId}>
        {stationNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <input
        list={fromListId}
        placeholder="From station"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input
          list={toListId}
          placeholder="To station"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={swap} title="Swap" style={swapBtnStyle}>⇅</button>
      </div>

      <button onClick={handlePlan} disabled={loading} style={findBtnStyle}>
        {loading ? "Finding…" : "Find Route"}
      </button>

      {error && (
        <div style={{ marginTop: 8, color: "#f87171", fontSize: 12 }}>{error}</div>
      )}

      {plan && <PlanResult plan={plan} />}
    </div>
  );
}

function PlanResult({ plan }: { plan: TripPlan }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
        <strong style={{ color: "#fff" }}>{plan.totalMinutes} min</strong>
        {" · "}{plan.totalStops} stops
        {plan.transferCount > 0 && ` · ${plan.transferCount} transfer${plan.transferCount > 1 ? "s" : ""}`}
      </div>
      {plan.segments.map((seg, i) => (
        <SegmentRow key={i} segment={seg} />
      ))}
    </div>
  );
}

function SegmentRow({ segment }: { segment: TripPlan["segments"][number] }) {
  if (segment.type === "transfer") {
    return (
      <div style={{ fontSize: 11, color: "#888", padding: "4px 0 4px 12px", fontStyle: "italic" }}>
        ↳ Transfer at {segment.atStopName} ({segment.minutes} min)
      </div>
    );
  }
  const info = getRouteInfo(segment.routeId);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: info.isExpress ? 4 : "50%",
          background: info.color,
          color: info.textColor,
          fontWeight: 700,
          fontSize: 11,
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        {segment.routeId}
      </span>
      <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.4 }}>
        <div>{segment.boardAt.stopName} → {segment.alightAt.stopName}</div>
        <div style={{ color: "#888", fontSize: 11 }}>
          {segment.minutes} min · {segment.intermediateStops + 1} stop{segment.intermediateStops === 0 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#e0e0e0",
  fontSize: 12,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const swapBtnStyle: React.CSSProperties = {
  width: 32,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 14,
  fontFamily: "inherit",
};

const findBtnStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "6px",
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};
