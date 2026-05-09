import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
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
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      dependencies: ["chromium"], // reuse server from chromium run
    },
  ],
  webServer: [
    {
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
    },
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
