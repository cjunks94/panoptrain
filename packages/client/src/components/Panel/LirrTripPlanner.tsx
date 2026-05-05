import { useState, useMemo, useId } from "react";
import type { FocusEvent } from "react";
import type {
  StopsGeoJSON,
  LirrTripPlan,
  LirrRideSegment,
  LirrTransferSegment,
} from "@panoptrain/shared";
import { fetchLirrPlan } from "../../lib/api.js";
import { getRouteInfo } from "../../lib/colors.js";

/** Mirror the iOS-Safari workaround in the subway TripPlanner — without this
 *  the on-screen keyboard covers the focused input on the bottom sheet. */
function scrollFocusedInputIntoView(e: FocusEvent<HTMLInputElement>) {
  const target = e.currentTarget;
  setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
}

interface LirrTripPlannerProps {
  stops: StopsGeoJSON | null;
  onPlanFound?: (plan: LirrTripPlan | null) => void;
}

export function LirrTripPlanner({ stops, onPlanFound }: LirrTripPlannerProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [plans, setPlans] = useState<LirrTripPlan[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromListId = useId();
  const toListId = useId();

  // LIRR has 1:1 station-to-stop mapping (no NYC-style multi-platform parents),
  // so the label-to-IDs map is simpler than the subway equivalent — each
  // station name → exactly one stop ID.
  const { labelToIds, labels } = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!stops) return { labelToIds: map, labels: [] as string[] };
    for (const f of stops.features) {
      const name = f.properties.stopName;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(f.properties.stopId);
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
      const result = await fetchLirrPlan(fromIds, toIds);
      setPlans(result.plans);
      setActiveIdx(0);
      onPlanFound?.(result.plans[0] ?? null);
    } catch (e) {
      // fetchJson surfaces failures as `Error("API <status>: <body>")`. Match
      // the prefix so we can show a friendly message for 404s and avoid
      // leaking raw backend response text for any other failure.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("LIRR trip plan failed:", e);
      setError(
        msg.startsWith("API 404")
          ? "No trains found in the next few hours"
          : "Unable to plan trip right now. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const selectPlan = (idx: number) => {
    setActiveIdx(idx);
    onPlanFound?.(plans[idx] ?? null);
  };

  const clearPlan = () => {
    setPlans([]);
    setActiveIdx(0);
    setError(null);
    onPlanFound?.(null);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const activePlan = plans[activeIdx] ?? null;

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#888", marginBottom: 8 }}>
        NEXT TRAINS
      </div>

      <datalist id={fromListId}>
        {labels.map((n) => <option key={n} value={n} />)}
      </datalist>
      <datalist id={toListId}>
        {labels.map((n) => <option key={n} value={n} />)}
      </datalist>

      <input
        list={fromListId}
        aria-label="From station"
        placeholder="From station"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        onFocus={scrollFocusedInputIntoView}
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input
          list={toListId}
          aria-label="To station"
          placeholder="To station"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onFocus={scrollFocusedInputIntoView}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={swap}
          title="Swap"
          aria-label="Swap from and to stations"
          style={swapBtnStyle}
        >
          ⇅
        </button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={handlePlan} disabled={loading} style={{ ...findBtnStyle, flex: 1 }}>
          {loading ? "Finding…" : "Find Next Train"}
        </button>
        {plans.length > 0 && (
          <button onClick={clearPlan} style={clearBtnStyle} aria-label="Clear active plan">
            Clear
          </button>
        )}
      </div>

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
              {formatHm(p.departAt)} · {p.totalMinutes}m
            </button>
          ))}
        </div>
      )}

      {activePlan && <LirrPlanResult plan={activePlan} />}
    </div>
  );
}

function LirrPlanResult({ plan }: { plan: LirrTripPlan }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
        <strong style={{ color: "#fff" }}>
          {formatHm(plan.departAt)} → {formatHm(plan.arriveAt)}
        </strong>
        {" · "}{plan.totalMinutes} min
        {plan.transferCount > 0 && ` · ${plan.transferCount} transfer`}
      </div>
      {plan.segments.map((seg, i) =>
        seg.type === "ride" ? (
          <LirrSegmentRow key={i} segment={seg} />
        ) : (
          <LirrTransferRow key={i} segment={seg} />
        ),
      )}
    </div>
  );
}

function LirrSegmentRow({ segment }: { segment: LirrRideSegment }) {
  const [expanded, setExpanded] = useState(false);
  // LIRR routes use color metadata from LIRR_ROUTE_GROUPS; getRouteInfo with
  // mode="lirr" surfaces the right color + shape (rounded square markers).
  const info = getRouteInfo(segment.routeId, "lirr");

  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 22,
            height: 22,
            padding: "0 6px",
            borderRadius: info.markerShape === "square" ? 4 : "50%",
            background: info.color,
            color: info.textColor,
            fontWeight: 700,
            fontSize: 10,
            flexShrink: 0,
            marginTop: 2,
            whiteSpace: "nowrap",
          }}
        >
          {segment.tripHeadsign || segment.routeId}
        </span>
        <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.4, flex: 1 }}>
          <div>{segment.boardAt.stopName} → {segment.alightAt.stopName}</div>
          <div style={{ color: "#888", fontSize: 11, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>
              Board {formatHm(segment.departAt)} · arrive {formatHm(segment.arriveAt)}
            </span>
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
            <div
              key={`${s.stopId}-${j}`}
              style={{
                fontSize: 11,
                color: j === 0 || j === segment.stops.length - 1 ? "#ccc" : "#777",
                padding: "1px 0",
                fontWeight: j === 0 || j === segment.stops.length - 1 ? 600 : 400,
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>{"●"} {s.stopName}</span>
              <span style={{ color: "#666" }}>{formatHm(s.arriveAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LirrTransferRow({ segment }: { segment: LirrTransferSegment }) {
  return (
    <div style={{ fontSize: 11, color: "#888", padding: "4px 0 4px 12px", fontStyle: "italic" }}>
      ↳ Transfer at {segment.atStopName} ({segment.minutes} min wait)
    </div>
  );
}

/** Format an epoch ms as NY-local h:mm AM/PM. */
function formatHm(epochMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(epochMs);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0 10px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#e0e0e0",
  fontSize: 16, // see TripPlanner: 16 prevents iOS auto-zoom
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const swapBtnStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  flexShrink: 0,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 16,
  fontFamily: "inherit",
};

const findBtnStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  minHeight: 44,
  padding: "0 12px",
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};

const clearBtnStyle: React.CSSProperties = {
  marginTop: 8,
  minHeight: 44,
  padding: "0 14px",
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "#aaa",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  flexShrink: 0,
};

const tabBtnStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "6px 10px",
  border: "1px solid",
  borderRadius: 14,
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "inherit",
  cursor: "pointer",
};
