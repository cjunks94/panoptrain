import type { Mode } from "@panoptrain/shared";

interface MapLoadingBadgeProps {
  mode: Mode;
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
export function MapLoadingBadge({ mode }: MapLoadingBadgeProps) {
  const label = mode === "lirr" ? "LIRR" : "subway";
  return (
    <div
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
