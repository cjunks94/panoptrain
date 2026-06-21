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

function serializeValue(v: unknown): unknown {
  // Errors lose their fields when JSON.stringify'd — flatten them so
  // we don't drop the message + stack on the floor.
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack };
  }
  return v;
}

function emit(stream: (s: string) => void, level: string, msg: string, ctx?: Record<string, unknown>): void {
  const line: Record<string, unknown> = { level, msg };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      line[k] = serializeValue(v);
    }
  }
  stream(JSON.stringify(line));
}

export const consoleLogger: Logger = {
  info: (msg, ctx) => emit(console.log.bind(console), "info", msg, ctx),
  warn: (msg, ctx) => emit(console.warn.bind(console), "warn", msg, ctx),
  error: (msg, ctx) => emit(console.error.bind(console), "error", msg, ctx),
};
