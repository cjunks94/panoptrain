import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Pins the consoleLogger contract: JSON-line output with `level` + `msg`
 * + arbitrary context fields, routed to console.log / warn / error by
 * level. Locking this shape now means a later pino swap is a one-file
 * change with the same wire format.
 */
describe("consoleLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should emit JSON with level, msg, and ctx fields when info is called with context", async () => {
    const { consoleLogger } = await import("../logger.js");

    consoleLogger.info("ok", { feed: "gtfs", count: 5 });

    expect(logSpy).toHaveBeenCalledOnce();
    const line = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "info", msg: "ok", feed: "gtfs", count: 5 });
  });

  it("should emit JSON with only level and msg when info is called without context", async () => {
    const { consoleLogger } = await import("../logger.js");

    consoleLogger.info("ok");

    const line = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(line).toEqual({ level: "info", msg: "ok" });
  });

  it("should route warn to console.warn with level=warn", async () => {
    const { consoleLogger } = await import("../logger.js");

    consoleLogger.warn("trouble");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
    const line = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(line.level).toBe("warn");
  });

  it("should route error to console.error with level=error", async () => {
    const { consoleLogger } = await import("../logger.js");

    consoleLogger.error("dead");

    expect(errorSpy).toHaveBeenCalledOnce();
    const line = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(line.level).toBe("error");
  });

  it("should serialize Error context to message + stack instead of dropping it", async () => {
    const { consoleLogger } = await import("../logger.js");
    const err = new Error("boom");

    consoleLogger.error("oops", { err });

    const line = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(line.err).toMatchObject({ message: "boom" });
    expect(typeof line.err.stack).toBe("string");
  });
});
