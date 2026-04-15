interface LineToggleProps {
  label: string;
  color: string;
  active: boolean;
  partial: boolean;
  onToggle: () => void;
}

export function LineToggle({ label, color, active, partial, onToggle }: LineToggleProps) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 16px",
        background: active ? "rgba(255,255,255,0.04)" : "transparent",
        border: "none",
        color: active ? "#e0e0e0" : "#666",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 500,
        textAlign: "left",
        transition: "all 0.15s ease",
      }}
    >
      {/* Color indicator */}
      <div
        style={{
          width: 32,
          height: 22,
          borderRadius: 11,
          background: active ? color : "rgba(255,255,255,0.08)",
          opacity: active ? 1 : partial ? 0.5 : 0.3,
          display: "flex",
          alignItems: "center",
          justifyContent: active ? "flex-end" : "flex-start",
          padding: "0 3px",
          transition: "all 0.15s ease",
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </div>

      {/* Route label */}
      <span style={{ letterSpacing: 1 }}>{label}</span>
    </button>
  );
}
