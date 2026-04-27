/** Padding (in pixels) applied to MapLibre `fitBounds` so the rendered bbox
 *  isn't covered by the filter panel. Calibrated to the panel's two layouts:
 *  desktop sidebar (320px wide on the left) vs mobile bottom sheet (75vh).
 *
 *  Pulled out as a pure function so the conditional is testable without
 *  spinning up MapLibre. Read by closure inside the auto-fit useEffects so
 *  panel toggles don't re-trigger fits — the latest memoized value is what
 *  the next fit picks up. */
export interface FitPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FitPaddingInput {
  isMobile: boolean;
  panelOpen: boolean;
  /** Current viewport height in pixels — needed to size the mobile
   *  bottom-sheet padding correctly across phone heights (iPhone SE through
   *  Pro Max). Ignored when not mobile or panel is closed. */
  viewportHeight: number;
}

/** The bottom sheet covers 75vh of viewport plus a small breathing room so
 *  the fitted bbox doesn't graze the sheet's top edge. Hardcoding 520px
 *  worked for iPhone SE but under-padded by 100-180px on iPhone 14 / Pro Max
 *  / Pixel 7, hiding the southern part of the network behind the sheet. */
const MOBILE_SHEET_FRACTION = 0.75;
const MOBILE_SHEET_BREATHING_ROOM = 30;

export function computeFitPadding({ isMobile, panelOpen, viewportHeight }: FitPaddingInput): FitPadding {
  if (!panelOpen) return { top: 60, bottom: 60, left: 60, right: 60 };
  if (isMobile) {
    const bottom = Math.round(viewportHeight * MOBILE_SHEET_FRACTION) + MOBILE_SHEET_BREATHING_ROOM;
    return { top: 60, bottom, left: 30, right: 30 };
  }
  return { top: 60, bottom: 60, left: 320, right: 60 };
}
