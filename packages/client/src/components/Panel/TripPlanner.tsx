import { useState, useMemo, useId } from "react";
import type { StopsGeoJSON, TripPlan } from "@panoptrain/shared";
import { fetchPlan } from "../../lib/api.js";
import { getRouteInfo } from "../../lib/colors.js";

interface TripPlannerProps {
  stops: StopsGeoJSON | null;
  onPlanFound?: (plan: TripPlan | null) => void;
}

export function TripPlanner({ stops, onPlanFound }: TripPlannerProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromListId = useId();
  const toListId = useId();

  // NYC complex stations like "Times Sq-42 St" appear as multiple parent stops
  // in GTFS, one per platform group (1/2/3, 7, S, N/Q/R/W). We surface two
  // levels of choice in the dropdown:
  //   - broad: just "Times Sq-42 St" -> searches from all parents (no transfer
  //     penalty for picking the right starting platform)
  //   - sub:   "Times Sq-42 St · 1 2 3" -> constrained to that platform group
  // Each label resolves to one or more parent stop IDs. The broad entry sorts
  // first because it has no " ·" suffix.
  const { labelToIds, labels } = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!stops) return { labelToIds: map, labels: [] as string[] };

    const byName = new Map<string, { id: string; routes: string[] }[]>();
    for (const f of stops.features) {
      const name = f.properties.stopName;
      const routes = (f.properties.routes as string[] | undefined) ?? [];
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push({ id: f.properties.stopId, routes });
    }

    for (const [name, entries] of byName.entries()) {
      if (entries.length > 1) {
        map.set(name, entries.map((e) => e.id));
        for (const e of entries) {
          const subLabel = e.routes.length > 0 ? `${name} · ${e.routes.join(" ")}` : name;
          if (!map.has(subLabel)) map.set(subLabel, [e.id]);
        }
      } else {
        const e = entries[0];
        const label = e.routes.length > 0 ? `${name} · ${e.routes.join(" ")}` : name;
        if (!map.has(label)) map.set(label, [e.id]);
      }
    }

    return { labelToIds: map, labels: Array.from(map.keys()).sort() };
  }, [stops]);

  const handlePlan = async () => {
    setError(null);
    setPlans([]);
    setActiveIdx(0);
    onPlanFound?.(null);
    const fromIds = labelToIds.get(from);
    const toIds = labelToIds.get(to);
    if (!fromIds || !toIds) {
      setError("Pick stations from the dropdown");
      return;
    }
    if (from === to) {
      setError("Pick two different stations");
      return;
    }
    setLoading(true);
    try {
      const result = await fetchPlan(fromIds, toIds);
      setPlans(result.plans);
      setActiveIdx(0);
      onPlanFound?.(result.plans[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectPlan = (idx: number) => {
    setActiveIdx(idx);
    onPlanFound?.(plans[idx] ?? null);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const activePlan = plans[activeIdx] ?? null;

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#888", marginBottom: 8 }}>
        PLAN TRIP
      </div>

      <datalist id={fromListId}>
        {labels.map((n) => <option key={n} value={n} />)}
      </datalist>
      <datalist id={toListId}>
        {labels.map((n) => <option key={n} value={n} />)}
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

      {plans.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
          {plans.map((p, i) => (
            <button
              key={i}
              onClick={() => selectPlan(i)}
              style={{
                ...tabBtnStyle,
                background: i === activeIdx ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)",
                borderColor: i === activeIdx ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)",
                color: i === activeIdx ? "#fff" : "#aaa",
              }}
            >
              {p.label} · {p.totalMinutes}m
            </button>
          ))}
        </div>
      )}

      {activePlan && <PlanResult plan={activePlan} />}
    </div>
  );
}

function PlanResult({ plan }: { plan: TripPlan }) {
  const totalDelay = plan.segments.reduce(
    (sum, s) => sum + (s.type === "ride" && s.delaySeconds ? s.delaySeconds : 0), 0,
  );
  const adjustedMin = plan.totalMinutes + Math.round(totalDelay / 60);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
        <strong style={{ color: "#fff" }}>{plan.totalMinutes} min</strong>
        {totalDelay > 0 && (
          <span style={{ color: "#f87171" }}> (est. {adjustedMin} min with delays)</span>
        )}
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
  const [expanded, setExpanded] = useState(false);

  if (segment.type === "transfer") {
    return (
      <div style={{ fontSize: 11, color: "#888", padding: "4px 0 4px 12px", fontStyle: "italic" }}>
        ↳ Transfer at {segment.atStopName} ({segment.minutes} min)
      </div>
    );
  }
  const info = getRouteInfo(segment.routeId);
  const delayMin = segment.delaySeconds ? Math.round(segment.delaySeconds / 60) : 0;

  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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
        <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.4, flex: 1 }}>
          <div>{segment.boardAt.stopName} → {segment.alightAt.stopName}</div>
          <div style={{ color: "#888", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
            <span>{segment.minutes} min · {segment.intermediateStops + 1} stop{segment.intermediateStops === 0 ? "" : "s"}</span>
            {delayMin > 0 && (
              <span style={{ color: "#f87171", fontWeight: 600 }}>+{delayMin} min late</span>
            )}
            {delayMin === 0 && segment.delaySeconds !== null && (
              <span style={{ color: "#22c55e", fontWeight: 600 }}>On time</span>
            )}
          </div>
          {segment.stops.length > 2 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{
                background: "none",
                border: "none",
                color: "#666",
                cursor: "pointer",
                fontSize: 10,
                padding: "2px 0",
                fontFamily: "inherit",
              }}
            >
              {expanded ? "▾ Hide stops" : `▸ Show ${segment.stops.length} stops`}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ marginLeft: 30, borderLeft: `2px solid ${info.color}`, paddingLeft: 10, marginTop: 4 }}>
          {segment.stops.map((s, j) => (
            <div key={s.stopId} style={{
              fontSize: 11,
              color: j === 0 || j === segment.stops.length - 1 ? "#ccc" : "#777",
              padding: "1px 0",
              fontWeight: j === 0 || j === segment.stops.length - 1 ? 600 : 400,
            }}>
              {"●"} {s.stopName}
            </div>
          ))}
        </div>
      )}
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

const tabBtnStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid",
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
};
