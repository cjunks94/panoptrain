/**
 * Minimal structured-logging interface. Emits one JSON line per call so
 * platform log aggregators (Railway / etc.) can parse it. Kept as an
 * interface — not a class — so the four pollers can take a `Logger`
 * dependency and tests can pass in a spy without hooking `console`.
 *
 * A future PR can swap the default `consoleLogger` for pino without
 * changing call sites. The shape (`level` + `msg` + arbitrary context
 * fields) is deliberately pino-compatible.
 */
export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info() {
    throw new Error("Not implemented");
  },
  warn() {
    throw new Error("Not implemented");
  },
  error() {
    throw new Error("Not implemented");
  },
};
