import { useState, useCallback, useEffect } from "react";
import { allRouteIdsForMode, routeGroupsForMode } from "@panoptrain/shared";
import type { Mode } from "@panoptrain/shared";

const STORAGE_PREFIX = "panoptrain:visibleRoutes";
const storageKey = (mode: Mode) => `${STORAGE_PREFIX}:${mode}`;

function loadFromStorage(mode: Mode): Set<string> {
  const defaults = () => new Set(allRouteIdsForMode(mode));
  try {
    const stored = localStorage.getItem(storageKey(mode));
    if (!stored) return defaults();
    const parsed = JSON.parse(stored) as string[];
    if (!Array.isArray(parsed)) return defaults();
    // Intentional "all off" (empty array) is preserved. But if the stored
    // set is non-empty and yet contains zero valid IDs for this mode, the
    // data is junk (e.g. subway IDs leaked into the LIRR slot by an older
    // buggy version) — reset to defaults rather than silently filter all
    // trains out.
    const valid = new Set(allRouteIdsForMode(mode));
    const filtered = new Set(parsed.filter((id) => valid.has(id)));
    if (parsed.length > 0 && filtered.size === 0) return defaults();
    return filtered;
  } catch {
    return defaults();
  }
}

function saveToStorage(mode: Mode, routes: Set<string>): void {
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify([...routes]));
  } catch {
    // Storage full or unavailable — ignore
  }
}

interface UseLineFilterResult {
  visibleRoutes: Set<string>;
  toggleRoute: (routeId: string) => void;
  toggleGroup: (groupLabel: string) => void;
  allOn: () => void;
  allOff: () => void;
}

/** Per-mode filter state: each mode keeps its own visibleRoutes set so
 *  toggling Babylon in LIRR doesn't clobber subway filters (PT-506). Both
 *  modes' state is held in memory simultaneously and indexed by mode, so
 *  switching modes is synchronous — no one-render flash where the previous
 *  mode's set briefly filters the new mode's data (which silently drops
 *  routes whose IDs don't overlap, e.g. LIRR Port Jefferson "10"). */
type StateByMode = Record<Mode, Set<string>>;

export function useLineFilter(mode: Mode): UseLineFilterResult {
  const [stateByMode, setStateByMode] = useState<StateByMode>(() => ({
    subway: loadFromStorage("subway"),
    lirr: loadFromStorage("lirr"),
  }));

  const visibleRoutes = stateByMode[mode];

  // Persist whichever mode just changed.
  useEffect(() => {
    saveToStorage(mode, stateByMode[mode]);
  }, [mode, stateByMode]);

  const updateForMode = useCallback(
    (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setStateByMode((prev) => ({
        ...prev,
        [mode]: typeof next === "function" ? next(prev[mode]) : next,
      }));
    },
    [mode],
  );

  const toggleRoute = useCallback((routeId: string) => {
    updateForMode((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  }, [updateForMode]);

  const toggleGroup = useCallback((groupLabel: string) => {
    const group = routeGroupsForMode(mode).find((g) => g.label === groupLabel);
    if (!group) return;
    updateForMode((prev) => {
      const next = new Set(prev);
      const allVisible = group.routes.every((r) => next.has(r));
      for (const r of group.routes) {
        if (allVisible) next.delete(r);
        else next.add(r);
      }
      return next;
    });
  }, [mode, updateForMode]);

  const allOn = useCallback(
    () => updateForMode(new Set(allRouteIdsForMode(mode))),
    [mode, updateForMode],
  );
  const allOff = useCallback(() => updateForMode(new Set()), [updateForMode]);

  return { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff };
}
