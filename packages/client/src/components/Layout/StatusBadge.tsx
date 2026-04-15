interface StatusBadgeProps {
  isStale: boolean;
  trainCount: number;
}

export function StatusBadge({ isStale, trainCount }: StatusBadgeProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 20,
        background: isStale ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)",
        border: `1px solid ${isStale ? "rgba(239, 68, 68, 0.4)" : "rgba(34, 197, 94, 0.4)"}`,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: isStale ? "#ef4444" : "#22c55e",
          animation: isStale ? "none" : "pulse 2s ease-in-out infinite",
        }}
      />
      <span style={{ color: isStale ? "#ef4444" : "#22c55e" }}>
        {isStale ? "Stale" : "Live"}
      </span>
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
