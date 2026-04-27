import { useEffect, useState } from "react";

/** Reactive viewport height — used to compute fitBounds padding so the bottom
 *  sheet's actual on-screen height (75vh) maps to a real pixel value at any
 *  device size. SSR-safe: returns 800 until mount (close to iPhone 14
 *  baseline so initial fits don't go wildly wrong before window is available). */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setHeight(window.innerHeight);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return height;
}
