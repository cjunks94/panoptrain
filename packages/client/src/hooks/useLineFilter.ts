import { useState, useCallback, useEffect } from "react";
import { ALL_ROUTE_IDS, ROUTE_GROUPS } from "@panoptrain/shared";

const STORAGE_KEY = "panoptrain:visibleRoutes";

function loadFromStorage(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Corrupt or unavailable — fall through to default
  }
  return new Set(ALL_ROUTE_IDS);
}

function saveToStorage(routes: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...routes]));
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

export function useLineFilter(): UseLineFilterResult {
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(loadFromStorage);

  useEffect(() => {
    saveToStorage(visibleRoutes);
  }, [visibleRoutes]);

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
    const group = ROUTE_GROUPS.find((g) => g.label === groupLabel);
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
  }, []);

  const allOn = useCallback(() => setVisibleRoutes(new Set(ALL_ROUTE_IDS)), []);
  const allOff = useCallback(() => setVisibleRoutes(new Set()), []);

  return { visibleRoutes, toggleRoute, toggleGroup, allOn, allOff };
}
