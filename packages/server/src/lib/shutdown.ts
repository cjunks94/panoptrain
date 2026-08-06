import { consoleLogger } from "./logger.js";

/**
 * Graceful shutdown wiring (#129).
 *
 * Railway sends SIGTERM before SIGKILL on every redeploy. Node's default
 * action for SIGTERM is immediate termination, so without this the process
 * dies mid-response. That is worse than it sounds here: responses pass
 * through `compress()`, so a client receives a truncated gzip stream — a
 * decode error rather than partial JSON — and in-flight upstream fetches are
 * dropped with no cleanup.
 */

/** How long to let in-flight requests finish before forcing exit. Railway's
 *  own SIGTERM->SIGKILL window is greater than this, so the forced path below
 *  should win the race and produce a clean log line rather than an opaque
 *  kill. */
export const SHUTDOWN_GRACE_MS = 8_000;

/** How often to reap sockets that have gone idle since the last sweep. */
export const IDLE_SWEEP_MS = 250;

export interface ShutdownDeps {
  /** Closes the HTTP listener; callback fires once connections are drained. */
  closeServer: (done: () => void) => void;
  /**
   * Closes keep-alive connections not currently serving a request.
   *
   * This is not optional in practice. `server.close()` waits for *every*
   * socket to close, and HTTP keep-alive means browsers hold idle sockets
   * open far longer than any sane grace period. Worse, a socket that was
   * busy at signal time becomes idle again the moment its response
   * completes — so a single sweep at signal time is not enough either. Both
   * failure modes were caught by the integration test; hence the repeating
   * sweep below rather than a one-shot call.
   */
  closeIdleConnections?: () => void;
  /** Force-closes all sockets, including ones mid-request. Last resort when
   *  the grace period expires. */
  closeAllConnections?: () => void;
  /** Stops background pollers. Errors here must not prevent exit. */
  stopPollers: () => void;
  /** Injected for testing. Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Injected for testing. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => { unref?: () => void };
  /** Injected for testing. Defaults to setInterval. */
  scheduleRepeating?: (fn: () => void, ms: number) => { unref?: () => void };
  /** Injected for testing. Clears a handle from `scheduleRepeating`. */
  clearRepeating?: (handle: unknown) => void;
  graceMs?: number;
  sweepMs?: number;
}

interface ConnectionClosers {
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

/**
 * Extracts the connection-closing methods from a server handle.
 *
 * `@hono/node-server`'s `ServerType` is a union that includes `Http2Server`,
 * which has no `closeIdleConnections` / `closeAllConnections` — those live on
 * `http.Server` and `https.Server` (Node >= 18.2). Feature-detecting keeps
 * this honest: on a server that lacks them we simply don't sweep, rather than
 * casting and crashing at runtime.
 */
export function connectionClosers(server: unknown): ConnectionClosers {
  const s = server as {
    closeIdleConnections?: unknown;
    closeAllConnections?: unknown;
  };
  return {
    closeIdleConnections:
      typeof s?.closeIdleConnections === "function"
        ? () => (s.closeIdleConnections as () => void).call(server)
        : undefined,
    closeAllConnections:
      typeof s?.closeAllConnections === "function"
        ? () => (s.closeAllConnections as () => void).call(server)
        : undefined,
  };
}

/**
 * Builds the signal handler. Returned function is safe to register on both
 * SIGTERM and SIGINT — repeat signals are ignored rather than starting a
 * second shutdown, which would double-close the server and race the exit.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const scheduleRepeating =
    deps.scheduleRepeating ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearRepeating =
    deps.clearRepeating ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout));
  const graceMs = deps.graceMs ?? SHUTDOWN_GRACE_MS;
  const sweepMs = deps.sweepMs ?? IDLE_SWEEP_MS;

  let shuttingDown = false;

  return function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    consoleLogger.info("shutdown starting", { signal, graceMs });

    // Stop pollers first so nothing new is scheduled while we drain, and so a
    // long poll interval can't hold the event loop open. A throw here must not
    // strand the process — we still need to close the server and exit.
    try {
      deps.stopPollers();
    } catch (err) {
      consoleLogger.error("error stopping pollers during shutdown", { err });
    }

    let sweepHandle: unknown = null;
    const stopSweep = (): void => {
      if (sweepHandle !== null) {
        clearRepeating(sweepHandle);
        sweepHandle = null;
      }
    };

    // Hard cap: if a wedged handler prevents the server from closing, force
    // the remaining sockets and exit rather than waiting for SIGKILL.
    const forced = schedule(() => {
      consoleLogger.error("shutdown timed out, forcing exit", { graceMs });
      stopSweep();
      try {
        deps.closeAllConnections?.();
      } catch (err) {
        consoleLogger.error("error force-closing connections", { err });
      }
      exit(1);
    }, graceMs);
    // Don't let the timer itself keep the process alive once draining is done.
    forced.unref?.();

    try {
      deps.closeServer(() => {
        stopSweep();
        consoleLogger.info("shutdown complete", { signal });
        exit(0);
      });

      // Reap idle sockets repeatedly, not once: connections busy at signal
      // time go idle as their responses complete, and each of those would
      // otherwise hold close() open until the grace period expired.
      if (deps.closeIdleConnections) {
        const sweep = (): void => {
          try {
            deps.closeIdleConnections!();
          } catch (err) {
            consoleLogger.error("error closing idle connections", { err });
          }
        };
        sweep(); // immediate pass for sockets already idle
        const handle = scheduleRepeating(sweep, sweepMs);
        handle.unref?.();
        sweepHandle = handle;
      }
    } catch (err) {
      stopSweep();
      consoleLogger.error("error closing server during shutdown", { err });
      exit(1);
    }
  };
}
