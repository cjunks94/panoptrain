import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parsePositiveInt } from "../config.js";
import type { Logger } from "../logger.js";

/**
 * Contract for the shared env-var parser (#90). The function's whole
 * point is failing-soft to the default with a structured warning when
 * the env value is invalid — silent NaN-then-zero was the prior bug.
 */

function makeLoggerSpy(): Logger & { warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> } {
  const warnings: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
  return {
    warnings,
    info: () => {},
    warn: (msg, ctx) => void warnings.push({ msg, ctx }),
    error: () => {},
  };
}

describe("parsePositiveInt", () => {
  const KEY = "PANOPTRAIN_TEST_VAR";

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    delete process.env[KEY];
    vi.restoreAllMocks();
  });

  it("should return the default when the env var is unset", () => {
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings).toHaveLength(0);
  });

  it("should return the default and stay silent when the env var is the empty string", () => {
    process.env[KEY] = "";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings).toHaveLength(0);
  });

  it("should return the parsed value when the env var is a valid positive integer string", () => {
    process.env[KEY] = "1500";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(1500);
    expect(logger.warnings).toHaveLength(0);
  });

  it("should fall back to the default and warn when the env var is not parseable as a number", () => {
    process.env[KEY] = "abc";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings[0]?.ctx).toMatchObject({ key: KEY, raw: "abc", default: 42 });
  });

  it("should fall back to the default and warn for non-integer numeric strings (5.5)", () => {
    process.env[KEY] = "5.5";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings).toHaveLength(1);
  });

  it("should fall back to the default and warn for zero (default min is 1)", () => {
    process.env[KEY] = "0";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings[0]?.ctx).toMatchObject({ parsed: 0 });
  });

  it("should fall back to the default and warn for negative integers", () => {
    process.env[KEY] = "-5";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 42, { logger });

    expect(result).toBe(42);
    expect(logger.warnings).toHaveLength(1);
  });

  it("should fall back to the default and warn when the value is below an explicit minimum", () => {
    process.env[KEY] = "30000";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 60_000, { min: 60_000, logger });

    expect(result).toBe(60_000);
    expect(logger.warnings[0]?.ctx).toMatchObject({ parsed: 30_000 });
  });

  it("should accept values equal to or above an explicit minimum", () => {
    process.env[KEY] = "90000";
    const logger = makeLoggerSpy();

    const result = parsePositiveInt(KEY, 60_000, { min: 60_000, logger });

    expect(result).toBe(90_000);
    expect(logger.warnings).toHaveLength(0);
  });
});
