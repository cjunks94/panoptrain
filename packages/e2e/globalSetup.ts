/**
 * Playwright globalSetup — waits for the server's first poll cycle to
 * complete before any test runs (#111).
 *
 * The webServer health check (`/api/health`) returns 200 the instant the
 * Hono server binds — long before the mta-poller has assembled its first
 * snapshot. Tests that depend on `count > 0` (smoke.spec.ts) raced this
 * window on mobile-viewport CI runs, where the browser's CPU throttle
 * also delayed the page-load enough that the client polled the server
 * during its 0-count window and rendered `0 trains`.
 *
 * Polling `/api/trains` until `count > 0` makes the readiness signal
 * align with what tests actually need.
 */
const TRAINS_URL = "http://localhost:3001/api/trains";
const TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

async function waitForTrains(): Promise<void> {
  const start = Date.now();
  let lastErr: string | null = null;

  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(TRAINS_URL);
      if (res.ok) {
        const body = (await res.json()) as { count: number };
        if (body.count > 0) {
          const elapsed = Date.now() - start;
          console.log(`[e2e-setup] server warm, ${body.count} trains after ${elapsed}ms`);
          return;
        }
        lastErr = `count=${body.count}`;
      } else {
        lastErr = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`[e2e-setup] /api/trains did not report count > 0 within ${TIMEOUT_MS}ms (last: ${lastErr})`);
}

export default async function globalSetup(): Promise<void> {
  await waitForTrains();
}
