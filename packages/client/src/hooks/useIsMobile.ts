import { useEffect, useState } from "react";

/** Shared breakpoint for "is this a phone-sized viewport". Exported so
 *  callers initializing one-shot state at mount (e.g. `panelOpen` default
 *  in App.tsx) hit the same breakpoint as the reactive hook below. */
export const MOBILE_QUERY = "(max-width: 767px)";

/** Reactive viewport check — flips if the user rotates a tablet or resizes
 *  desktop down to mobile widths. SSR-safe: returns false until mount.
 *
 *  Lifted out of FilterPanel so callers like TransitMap can adjust map-level
 *  layout (e.g. fitBounds padding for the bottom sheet vs left sidebar). */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}
