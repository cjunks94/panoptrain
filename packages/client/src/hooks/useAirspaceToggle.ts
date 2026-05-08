import { useState, useCallback } from "react";

const STORAGE_KEY = "panoptrain:airspace:enabled";

/**
 * Persists the airspace overlay toggle in localStorage so users don't have
 * to re-enable it on every load. Defaults off — surfaces aircraft only
 * when the user opts in, since the existing audience came for trains.
 */
export function useAirspaceToggle(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // Privacy modes / disabled storage — default off without throwing.
      return false;
    }
  });
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore — toggle still works in-session, just won't persist
    }
  }, []);
  return [enabled, setEnabled];
}
