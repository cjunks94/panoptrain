import { describe, it, expect, vi } from "vitest";
import { createShutdownHandler } from "../shutdown.js";

function harness(overrides: Partial<Parameters<typeof createShutdownHandler>[0]> = {}) {
  const exit = vi.fn();
  const stopPollers = vi.fn();
  const scheduled: { fn: () => void; ms: number }[] = [];
  const unref = vi.fn();
  const schedule = vi.fn((fn: () => void, ms: number) => {
    scheduled.push({ fn, ms });
    return { unref };
  });
  let drain: (() => void) | null = null;
  const closeServer = vi.fn((done: () => void) => {
    drain = done;
  });

  const shutdown = createShutdownHandler({
    closeServer,
    stopPollers,
    exit,
    schedule,
    graceMs: 8_000,
    ...overrides,
  });

  return {
    shutdown,
    exit,
    stopPollers,
    closeServer,
    schedule,
    scheduled,
    unref,
    finishDrain: () => drain?.(),
  };
}

describe("createShutdownHandler", () => {
  it("should stop pollers and close the server when signalled", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    expect(h.stopPollers).toHaveBeenCalledOnce();
    expect(h.closeServer).toHaveBeenCalledOnce();
  });

  it("should stop pollers before closing the server", () => {
    const order: string[] = [];
    const h = harness({
      stopPollers: () => order.push("pollers"),
      closeServer: () => order.push("close"),
    });
    h.shutdown("SIGTERM");
    expect(order).toEqual(["pollers", "close"]);
  });

  it("should exit 0 once connections have drained", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    expect(h.exit).not.toHaveBeenCalled();
    h.finishDrain();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("should arm a hard-exit timer with the configured grace period", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].ms).toBe(8_000);
  });

  it("should exit 1 when draining exceeds the grace period", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    h.scheduled[0].fn(); // simulate the timer firing
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("should unref the hard-exit timer so it cannot hold the process open", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    expect(h.unref).toHaveBeenCalledOnce();
  });

  it("should ignore a repeat signal instead of shutting down twice", () => {
    const h = harness();
    h.shutdown("SIGTERM");
    h.shutdown("SIGTERM");
    h.shutdown("SIGINT");
    expect(h.stopPollers).toHaveBeenCalledOnce();
    expect(h.closeServer).toHaveBeenCalledOnce();
    expect(h.schedule).toHaveBeenCalledOnce();
  });

  it("should still close the server when stopping pollers throws", () => {
    const h = harness({
      stopPollers: () => {
        throw new Error("poller boom");
      },
    });
    expect(() => h.shutdown("SIGTERM")).not.toThrow();
    expect(h.closeServer).toHaveBeenCalledOnce();
  });

  it("should exit 1 when closing the server throws", () => {
    const h = harness({
      closeServer: () => {
        throw new Error("close boom");
      },
    });
    h.shutdown("SIGTERM");
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  // --- idle keep-alive reaping ---
  // server.close() waits on every socket. Browsers hold idle keep-alive
  // sockets open, and a socket busy at signal time goes idle the moment its
  // response completes — so this must sweep repeatedly, not once.

  function sweepHarness() {
    const exit = vi.fn();
    const closeIdleConnections = vi.fn();
    const closeAllConnections = vi.fn();
    const repeating: { fn: () => void; ms: number }[] = [];
    const clearRepeating = vi.fn();
    const timers: { fn: () => void; ms: number }[] = [];
    let drain: (() => void) | null = null;

    const shutdown = createShutdownHandler({
      closeServer: (done) => {
        drain = done;
      },
      closeIdleConnections,
      closeAllConnections,
      stopPollers: () => {},
      exit,
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return { unref: () => {} };
      },
      scheduleRepeating: (fn, ms) => {
        repeating.push({ fn, ms });
        return { unref: () => {} };
      },
      clearRepeating,
      graceMs: 8_000,
      sweepMs: 250,
    });

    return {
      shutdown,
      exit,
      closeIdleConnections,
      closeAllConnections,
      repeating,
      clearRepeating,
      timers,
      finishDrain: () => drain?.(),
    };
  }

  it("should sweep idle connections immediately on shutdown", () => {
    const h = sweepHarness();
    h.shutdown("SIGTERM");
    expect(h.closeIdleConnections).toHaveBeenCalledOnce();
  });

  it("should keep sweeping so sockets that go idle later are also reaped", () => {
    const h = sweepHarness();
    h.shutdown("SIGTERM");
    expect(h.repeating).toHaveLength(1);
    expect(h.repeating[0].ms).toBe(250);

    h.repeating[0].fn();
    h.repeating[0].fn();
    expect(h.closeIdleConnections).toHaveBeenCalledTimes(3); // 1 immediate + 2 sweeps
  });

  it("should stop sweeping once the server has closed", () => {
    const h = sweepHarness();
    h.shutdown("SIGTERM");
    h.finishDrain();
    expect(h.clearRepeating).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("should force-close all connections and stop sweeping when grace expires", () => {
    const h = sweepHarness();
    h.shutdown("SIGTERM");
    h.timers[0].fn(); // grace timer fires
    expect(h.closeAllConnections).toHaveBeenCalledOnce();
    expect(h.clearRepeating).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("should keep draining when a sweep throws", () => {
    const h = sweepHarness();
    h.closeIdleConnections.mockImplementation(() => {
      throw new Error("sweep boom");
    });
    expect(() => h.shutdown("SIGTERM")).not.toThrow();
    h.finishDrain();
    expect(h.exit).toHaveBeenCalledWith(0);
  });
});
