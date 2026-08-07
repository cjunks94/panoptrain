import type { Mode } from "@panoptrain/shared";

interface MapLoadingBadgeProps {
  mode: Mode;
  /** When set, the load failed — render a retry affordance instead of a
   *  spinner. Without this the badge simply disappeared on failure and the
   *  user was left with a silently empty map (#133). */
  error?: Error | null;
  onRetry?: () => void;
}

/**
 * Top-center pill shown while route shapes / stops are still fetching.
 * Without it, a cold mode flip looks like a blank map for the time it
 * takes to pull the multi-MB GeoJSON; with it, the user gets immediate
 * feedback that something is in flight.
 *
 * The 200ms `animation-delay` keeps the badge invisible on fast loads
 * (cache hits, warm sessions) — if shapes arrive before the delay
 * elapses, the badge unmounts without ever fading in.
 */
export function MapLoadingBadge({ mode, error, onRetry }: MapLoadingBadgeProps) {
  const label = mode === "lirr" ? "LIRR" : "subway";

  if (error) {
    return (
      <div
        role="alert"
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px 6px 14px",
          borderRadius: 20,
          background: "rgba(69, 10, 10, 0.92)",
          border: "1px solid rgba(248, 113, 113, 0.4)",
          color: "#fecaca",
          fontSize: 12,
          fontWeight: 600,
          zIndex: 10,
        }}
      >
        <span>Couldn’t load {label} routes</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: "3px 10px",
              borderRadius: 12,
              border: "1px solid rgba(248, 113, 113, 0.5)",
              background: "rgba(248, 113, 113, 0.15)",
              color: "#fecaca",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        position: "absolute",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 20,
        background: "rgba(15, 23, 42, 0.85)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        color: "#e2e8f0",
        fontSize: 12,
        fontWeight: 600,
        pointerEvents: "none",
        zIndex: 10,
        opacity: 0,
        animation: "mapLoadingBadgeFadeIn 200ms ease-out 200ms forwards",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#94a3b8",
          animation: "mapLoadingBadgePulse 1.2s ease-in-out infinite",
        }}
      />
      <span>Loading {label} routes…</span>
      <style>{`
        @keyframes mapLoadingBadgeFadeIn {
          to { opacity: 1; }
        }
        @keyframes mapLoadingBadgePulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
