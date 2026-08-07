/**
 * Compute MapLibre flyTo options for the "user picked an airport from
 * the directory" flow. Two adjustments versus a naive
 * flyTo({ center, zoom: 12 }):
 *
 *  1. **Offset** — pin lands toward the bottom of the *visible* map so
 *     the popup has room to extend upward without clipping the top
 *     edge or being hidden by the bottom-sheet panel on mobile.
 *  2. **Per-importance zoom** — hubs render at a wider zoom (more metro
 *     context, see other airports) and regional GA fields render
 *     tighter. User-initiated deeper zooms are preserved — we only
 *     pull *in* if the user is currently zoomed out.
 */

export interface AirportFocusInput {
  importance: 0 | 1 | 2;
  /** map.getZoom() at the moment of the click. */
  currentZoom: number;
  isMobile: boolean;
  panelOpen: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface AirportFocusOptions {
  /** flyTo offset, in pixels relative to the visible map center. */
  offset: [number, number];
  /** flyTo target zoom. */
  zoom: number;
}

const SIDEBAR_WIDTH_PX = 260;

/** MapLibre's offset prop semantics: positive y shifts the destination
 *  point DOWN on screen (so a positive y-offset means "the airport
 *  appears lower in the viewport"). Negative y pushes it up. */
export function airportFocusOptions(input: AirportFocusInput): AirportFocusOptions {
  return {
    offset: [computeOffsetX(input), computeOffsetY(input)],
    zoom: zoomForImportance(input.importance, input.currentZoom),
  };
}

function computeOffsetX({ isMobile, panelOpen, viewportWidth }: AirportFocusInput): number {
  if (isMobile || !panelOpen) return 0;
  // Desktop with the 260px sidebar: shift the target right by half the
  // sidebar width so the airport lands centered in the *visible* map
  // area (the strip to the right of the panel) instead of being
  // partially obscured by it.
  // Guard against degenerate viewports — the offset only makes sense
  // when there's meaningfully more map width than sidebar.
  if (viewportWidth <= SIDEBAR_WIDTH_PX) return 0;
  return SIDEBAR_WIDTH_PX / 2;
}

function computeOffsetY({ isMobile, panelOpen, viewportHeight }: AirportFocusInput): number {
  if (isMobile && panelOpen) {
    // Bottom sheet covers ~75vh; visible map is the top strip. Push the
    // airport into the lower portion of that strip so the popup
    // extends upward into open map area instead of clipping the top.
    // Visible map height = viewport * 0.25; visible center = viewport * 0.125.
    // Want airport at ~0.20 * viewport (toward bottom of visible strip).
    // Offset = target_y - actual_center_y = 0.20*vh - 0.5*vh = -0.30*vh.
    return -viewportHeight * 0.3;
  }
  // Desktop, or mobile with panel closed: full viewport visible. Pin in
  // lower third (~67vh from top) so the popup has room to extend upward.
  // Offset = 0.67*vh - 0.5*vh = +0.17*vh.
  return viewportHeight * 0.17;
}

function zoomForImportance(importance: 0 | 1 | 2, currentZoom: number): number {
  // Hubs benefit from metro-wide context (you can see EWR/JFK/LGA
  // together at zoom 11.5); regional fields are sparser landmarks
  // and benefit from a tighter view. Don't pull the user *out* if
  // they're already zoomed in deeper than the bucket default.
  const target = importance === 2 ? 11.5 : importance === 1 ? 12 : 12.5;
  return Math.max(currentZoom, target);
}
