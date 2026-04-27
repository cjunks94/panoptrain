import { useEffect, useState } from "react";
import type { Mode } from "@panoptrain/shared";

const STORAGE_KEY = "panoptrain.mode";

function isMode(v: unknown): v is Mode {
  return v === "subway" || v === "lirr";
}

/** Persisted top-level transit mode (PT-504). Reads the last-used value
 *  from localStorage on mount so a returning user lands back on whatever
 *  they were viewing; falls back to subway if absent or storage is blocked. */
export function useMode(): [Mode, (next: Mode) => void] {
  const [mode, setModeState] = useState<Mode>(() => {
    if (typeof window === "undefined") return "subway";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return isMode(stored) ? stored : "subway";
    } catch {
      return "subway";
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private mode / blocked storage — silent fallback to in-memory only.
    }
  }, [mode]);

  return [mode, setModeState];
}
