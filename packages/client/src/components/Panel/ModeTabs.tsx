import type { View } from "../../hooks/useView.js";

interface ModeTabsProps {
  view: View;
  onChange: (next: View) => void;
}

const TABS: { key: View; label: string }[] = [
  { key: "subway", label: "Subway" },
  { key: "lirr", label: "LIRR" },
  { key: "airspace", label: "Airspace" },
];

/** Top-of-panel tab strip switching between subway, LIRR, and airspace.
 *  Mutually exclusive: only one view's data is loaded at a time. */
export function ModeTabs({ view, onChange }: ModeTabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        padding: "8px 8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {TABS.map((t) => {
        const active = t.key === view;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              minHeight: 36,
              padding: "0 12px",
              background: active ? "rgba(255,255,255,0.10)" : "transparent",
              border: "1px solid",
              borderColor: active ? "rgba(255,255,255,0.25)" : "transparent",
              borderBottom: active ? "1px solid rgba(255,255,255,0.10)" : "1px solid transparent",
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              color: active ? "#fff" : "#888",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
