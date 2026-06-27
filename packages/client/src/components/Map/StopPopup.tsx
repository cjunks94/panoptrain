import { Popup } from "react-map-gl/maplibre";
import { ROUTE_INFO, type StopFeature } from "@panoptrain/shared";

/**
 * Click-to-inspect station popup. Shows station name, GTFS stop ID, and
 * the routes serving the stop as color-coded chips. Mirrors the
 * react-map-gl Popup pattern used by AirportPopup (static position,
 * no per-frame DOM repositioning needed since stations don't move).
 */
interface StopPopupProps {
  stop: StopFeature;
  onClose: () => void;
}

export function StopPopup({ stop, onClose }: StopPopupProps) {
  const [lng, lat] = stop.geometry.coordinates;
  const { stopName, stopId, routes = [], importance } = stop.properties;

  return (
    <Popup
      className="stop-popup"
      longitude={lng}
      latitude={lat}
      anchor="bottom"
      offset={14}
      closeButton={false}
      closeOnClick={false}
      onClose={onClose}
      maxWidth="min(280px, calc(100vw - 32px))"
    >
      <div
        style={{
          background: "rgba(15, 23, 42, 0.97)",
          color: "#e2e8f0",
          borderRadius: 6,
          padding: "10px 14px",
          fontSize: 12,
          lineHeight: 1.4,
          border: "1px solid rgba(148, 163, 184, 0.3)",
        }}
      >
        <Header stopName={stopName} importance={importance} onClose={onClose} />
        <div
          style={{
            color: "#94a3b8",
            fontSize: 11,
            marginBottom: routes.length > 0 ? 8 : 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Stop ID · {stopId}
        </div>
        {routes.length > 0 && <RoutesRow routes={routes} />}
      </div>
      <style>{`
        .stop-popup .maplibregl-popup-content {
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .stop-popup .maplibregl-popup-tip {
          border-top-color: rgba(15, 23, 42, 0.97) !important;
        }
      `}</style>
    </Popup>
  );
}

function Header({
  stopName,
  importance,
  onClose,
}: {
  stopName: string;
  importance: 0 | 1 | 2 | undefined;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>{stopName}</div>
        {importance === 2 && <HubBadge />}
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          minWidth: 44,
          minHeight: 44,
          margin: "-10px -14px -10px 0",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function HubBadge() {
  return (
    <span
      style={{
        background: "#fef08a",
        color: "#0a0a1a",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 5px",
        borderRadius: 3,
        lineHeight: 1,
        textTransform: "uppercase",
      }}
    >
      Hub
    </span>
  );
}

function RoutesRow({ routes }: { routes: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {routes.map((routeId) => (
        <RouteChip key={routeId} routeId={routeId} />
      ))}
    </div>
  );
}

function RouteChip({ routeId }: { routeId: string }) {
  // Fall back to a neutral chip for routeIds we don't have brand colors for
  // (LIRR routeIds, future modes). The chip still surfaces the routeId so
  // a reader can identify the line by name.
  const info = ROUTE_INFO[routeId];
  const bg = info?.color ?? "#475569";
  const fg = info?.textColor ?? "#f1f5f9";
  return (
    <span
      style={{
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 10,
        lineHeight: 1.3,
        minWidth: 18,
        textAlign: "center",
      }}
    >
      {info?.name ?? routeId}
    </span>
  );
}
