import { forwardRef } from "react";
import type { TrainInfo } from "../../hooks/useTrainFeatures.js";
import { trainNumber } from "../../lib/popupPlacement.js";

interface TrainPopupProps {
  train: TrainInfo;
  /** True when the camera is currently following this train. Drives the
   *  follow/unfollow button label and styling. */
  following: boolean;
  onClose: () => void;
  onToggleFollow: () => void;
}

/** Floating info card that sits next to a moving train. Position is updated
 *  every RAF tick via direct DOM manipulation in TransitMap (no React render
 *  on each frame); content is React-rendered only on prop changes (route ID,
 *  status, delay, follow state).
 *
 *  Translucent dark background so the card blends with the dark basemap.
 *  Position relative to the train is computed perpendicular to the train's
 *  direction of motion (see popupOffsetPx) so the card never sits in the
 *  train's path or directly behind it. */
export const TrainPopup = forwardRef<HTMLDivElement, TrainPopupProps>(
  function TrainPopup({ train, following, onClose, onToggleFollow }, ref) {
    const trainNo = trainNumber(train.tripId);
    return (
      <div
        ref={ref}
        role="dialog"
        aria-label={`${train.routeId} train info`}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          // Initial off-screen position; RAF overrides on first tick.
          transform: "translate(-9999px, -9999px)",
          zIndex: 5,
          minWidth: 200,
          maxWidth: 260,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(10, 10, 26, 0.85)",
          color: "#e0e0e0",
          fontSize: 13,
          lineHeight: 1.5,
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: train.color,
              color: train.textColor,
              fontWeight: 700,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            {train.label}
          </span>
          <strong style={{ flex: 1, color: "#fff" }}>{train.destination}</strong>
          {/* 44×44 hit area meets the project's mobile touch-target standard
              even though the × glyph itself stays visually compact. Negative
              margin pulls the button into the popup's padding so the popup
              doesn't visually grow to accommodate the larger button. */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              minWidth: 44,
              minHeight: 44,
              margin: "-10px -12px -10px 0",
              padding: 0,
              border: "none",
              background: "transparent",
              color: "#888",
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Status line + train number tag share a row so neither crowds the
            destination header. Train number is right-aligned and dimmed so
            it reads as a secondary identifier, not competing with status. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ flex: 1 }}>
            {train.status === "STOPPED_AT"
              ? `At ${train.currentStopName}`
              : `En route to ${train.currentStopName}`}
          </span>
          {trainNo && (
            <span
              style={{
                color: "#888",
                fontSize: 11,
                fontFamily: "monospace",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              #{trainNo}
            </span>
          )}
        </div>

        {train.delay !== null && train.delay !== 0 && (
          <div style={{ color: train.delay > 0 ? "#f87171" : "#4ade80" }}>
            {train.delay > 0
              ? `${Math.round(train.delay / 60)} min late`
              : `${Math.abs(Math.round(train.delay / 60))} min early`}
          </div>
        )}

        <button
          onClick={onToggleFollow}
          style={{
            marginTop: 8,
            width: "100%",
            minHeight: 36,
            padding: "0 10px",
            background: following ? "rgba(255, 255, 255, 0.1)" : train.color,
            color: following ? "#fff" : train.textColor,
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {following ? "Stop following" : "Follow this train"}
        </button>
      </div>
    );
  },
);
