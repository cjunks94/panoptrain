import { useState, useCallback, useEffect } from "react";
import { allRouteIdsForMode, routeGroupsForMode } from "@panoptrain/shared";
import type { Mode } from "@panoptrain/shared";

const STORAGE_PREFIX = "panoptrain:visibleRoutes";
const storageKey = (mode: Mode) => `${STORAGE_PREFIX}:${mode}`;

function loadFromStorage(mode: Mode): Set<string> {
  try {
    const stored = localStorage.getItem(storageKey(mode));
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Corrupt or unavailable — fall through to default
  }
  return new Set(allRouteIdsForMode(mode));
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

/** Per-mode filter state: each mode (subway / lirr) gets its own persisted
 *  visibleRoutes set so toggling Babylon in LIRR doesn't clobber subway
 *  filters and vice versa (PT-506). */
export function useLineFilter(mode: Mode): UseLineFilterResult {
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(() => loadFromStorage(mode));

  // Switch to the saved set for the new mode when mode flips.
  useEffect(() => {
    setVisibleRoutes(loadFromStorage(mode));
  }, [mode]);

  useEffect(() => {
    saveToStorage(mode, visibleRoutes);
  }, [mode, visibleRoutes]);

  const toggleRoute = useCallback((routeId: string) => {
    setVisibleRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        next.add(routeId);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupLabel: string) => {
    const group = routeGroupsForMode(mode).find((g) => g.label === groupLabel);
    if (!group) return;

    setVisibleRoutes((prev) => {
      const next = new Set(prev);
      const allVisible = group.routes.every((r) => next.has(r));

      for (const r of group.routes) {
        if (allVisible) {
          next.delete(r);
        } else {
          next.add(r);
        }
      }
      return next;
    });
  }, [mode]);

  const allOn = useCallback(() => setVisibleRoutes(new Set(allRouteIdsForMode(mode))), [mode]);
  const allOff = useCallback(() => setVisibleRoutes(new Set()), []);

  return { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff };
}
