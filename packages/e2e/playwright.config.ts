import { defineConfig, devices } from "@playwright/test";

/**
 * The API server entry is shared with playwright.prod.config.ts, which runs
 * the same suite against the production bundle instead of the Vite dev
 * server (#182). Keep anything both targets need in `shared` below; only
 * baseURL and the client webServer differ per target.
 */
export const apiServer = {
  // dev:e2e installs MSW handlers for MTA + adsb.lol before the
  // server boots, so the pollers' first fetch hits canned fixtures
  // instead of the real upstreams. Tests run with deterministic data,
  // no network latency, and zero upstream dependency.
  command: "pnpm --filter @panoptrain/server dev:e2e",
  url: "http://localhost:3001/api/health",
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
  stdout: "ignore",
  stderr: "pipe",
} as const;

export const shared = defineConfig({
  testDir: "./tests",
  // Wait for the server's first poll cycle to complete before any test
  // runs — webServer URL check only verifies `/api/health` 200, which
  // returns the instant the server binds. Mobile viewports + CPU throttle
  // raced this window and saw `count = 0` (#111).
  globalSetup: "./globalSetup.ts",
  // Tests are deterministic now (server data is mocked via MSW), so we
  // can safely run files in parallel. `fullyParallel: true` also runs
  // tests *within* a file in parallel, which is fine — none of these
  // tests share state across the page boundary.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 4 workers locally, capped to 2 in CI where runners are smaller. Each
  // worker spins up its own browser context, so memory scales linearly.
  workers: process.env.CI ? 2 : 4,
  // JSON reporter runs alongside the human-facing reporter so we can profile
  // per-test duration + flake rate across runs (see scripts/profile-flakes.ts).
  reporter: [
    [process.env.CI ? "github" : "list"],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // mobile.spec.ts covers touch-target sizing, bottom-sheet behavior,
      // and mobile-only plan flows — running it on a desktop viewport is
      // wasted work (15 tests × 25-48s each per CI run, profile-flakes
      // measured chromium's mobile.spec.ts at ~3.5 min). Tests stay
      // covered by the two mobile projects.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      // map.spec.ts drives three full WebGL map loads per project. On the
      // Pixel 7 profile (deviceScaleFactor 2.625) that is a ~7x larger
      // canvas through SwiftShader, and on 2-vCPU CI runners it starved the
      // main thread enough that unrelated panel clicks in smoke/mobile
      // specs hung past their 30s timeout (3 runs on 2026-09-09, all
      // mobile-chrome, all "done scrolling" then silence). The map
      // assertions are engine-level, not viewport-level: chromium already
      // covers Blink and mobile-safari covers WebKit, so nothing is lost.
      testIgnore: /map\.spec\.ts/,
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});

/** Default target: Vite dev server on 5173, proxying /api to the server. */
export default defineConfig({
  ...shared,
  metadata: { target: "dev" },
  use: {
    ...shared.use,
    baseURL: "http://localhost:5173",
  },
  webServer: [
    apiServer,
    {
      command: "pnpm --filter @panoptrain/client dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
