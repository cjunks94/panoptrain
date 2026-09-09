interface StatusBadgeProps {
  isStale: boolean;
  trainCount: number;
  /** Feed ids the server served from its fallback cache or dropped on the
   *  last poll (#143). Non-empty renders the amber "Degraded" state: trains
   *  on those lines are moving on predictions up to 5 min old. */
  degradedFeeds?: string[];
}

/** Stale (client has not heard from the server) outranks degraded (server
 *  is answering, but part of its upstream is down). */
type BadgeState = "live" | "degraded" | "stale";

const STATE_STYLE: Record<BadgeState, { color: string; bg: string; border: string; label: string }> = {
  live: { color: "#22c55e", bg: "rgba(34, 197, 94, 0.2)", border: "rgba(34, 197, 94, 0.4)", label: "Live" },
  degraded: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.2)", border: "rgba(245, 158, 11, 0.4)", label: "Degraded" },
  stale: { color: "#ef4444", bg: "rgba(239, 68, 68, 0.2)", border: "rgba(239, 68, 68, 0.4)", label: "Stale" },
};

export function StatusBadge({ isStale, trainCount, degradedFeeds = [] }: StatusBadgeProps) {
  const state: BadgeState = isStale ? "stale" : degradedFeeds.length > 0 ? "degraded" : "live";
  const s = STATE_STYLE[state];
  const title =
    state === "degraded"
      ? `Serving cached data for: ${degradedFeeds.join(", ")}`
      : undefined;
  return (
    <div
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 20,
        background: s.bg,
        border: `1px solid ${s.border}`,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: s.color,
          animation: state === "live" ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      <span style={{ color: s.color }}>{s.label}</span>
      <span style={{ color: "#999" }}>{trainCount} trains</span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
