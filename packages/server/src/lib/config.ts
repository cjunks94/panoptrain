import { consoleLogger, type Logger } from "./logger.js";

/**
 * Centralized env-var parsing for the server (#90). Replaces ad-hoc
 * `parseInt(process.env.FOO ?? "default", 10)` patterns sprinkled
 * through `index.ts` and route handlers, where a typo (`POLL_INTRVL`)
 * silently yielded `NaN` → `0` → broken `setInterval` near-zero polling
 * that hammered upstream APIs.
 *
 * Every numeric env var should route through `parsePositiveInt`; invalid
 * input falls back to the documented default with a structured warning
 * log instead of failing silently.
 */
export interface ParsePositiveIntOptions {
  /**
   * Lower bound (inclusive). Values below this fall back to the default
   * with a warning. Defaults to 1 — a "positive int" must be ≥ 1.
   */
  min?: number;
  /** Logger sink for invalid-input warnings. Defaults to `consoleLogger`. */
  logger?: Logger;
}

export function parsePositiveInt(
  envKey: string,
  defaultValue: number,
  options: ParsePositiveIntOptions = {},
): number {
  const { min = 1, logger = consoleLogger } = options;
  const raw = process.env[envKey];

  if (raw === undefined || raw === "") return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    logger.warn("env var rejected, using default", {
      key: envKey,
      raw,
      reason: "not a finite integer",
      default: defaultValue,
    });
    return defaultValue;
  }

  if (parsed < min) {
    logger.warn("env var rejected, using default", {
      key: envKey,
      raw,
      parsed,
      reason: `below minimum ${min}`,
      default: defaultValue,
    });
    return defaultValue;
  }

  return parsed;
}
