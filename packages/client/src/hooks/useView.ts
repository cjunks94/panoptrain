import { useEffect, useState } from "react";
import type { Mode } from "@panoptrain/shared";

/**
 * Top-level view selection. `Mode` is server-aware (subway/LIRR drive feed,
 * GTFS, and route lookups) and stays narrow upstream. `View` is the
 * client-only superset that adds "airspace" — handled entirely in the
 * frontend since the airspace endpoints aren't mode-dispatched.
 */
export type View = Mode | "airspace";

const STORAGE_KEY = "panoptrain.view";
// Honors the legacy `panoptrain.mode` key so users mid-session don't get
// reset to subway when this PR ships. We migrate inline on first read and
// then write to the new key going forward.
const LEGACY_MODE_KEY = "panoptrain.mode";

function isView(v: unknown): v is View {
  return v === "subway" || v === "lirr" || v === "airspace";
}

export function useView(): [View, (next: View) => void] {
  const [view, setViewState] = useState<View>(() => {
    if (typeof window === "undefined") return "subway";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isView(stored)) return stored;
      const legacy = window.localStorage.getItem(LEGACY_MODE_KEY);
      if (isView(legacy)) return legacy;
      return "subway";
    } catch {
      return "subway";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // Private mode / blocked storage — silent fallback to in-memory only.
    }
  }, [view]);

  return [view, setViewState];
}

/** Narrow a View to a Mode — null when the view is airspace. Use this to
 *  gate hooks that fetch transit data so they stop polling on airspace. */
export function transitModeFor(view: View): Mode | null {
  return view === "airspace" ? null : view;
}
