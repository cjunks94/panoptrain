/**
 * E2E entry point. Used by `pnpm dev:e2e` (which Playwright's webServer
 * launches in test mode). Two responsibilities:
 *
 *  1. Override env defaults that don't apply when fixtures are frozen in
 *     time. Captured GTFS-RT timestamps go stale fast, so the trains
 *     route's TTL filter (default 300s) would empty the response — bump
 *     it to effectively infinity for tests.
 *  2. Install MSW handlers BEFORE index.ts runs, so the pollers' first
 *     fetch call already hits canned fixtures.
 *
 * Module evaluation order is critical: ESM imports run in source order
 * with all hoisted. We pre-set env vars before the dynamic import so
 * routes/trains.ts reads them at module init.
 */
process.env.TRAINS_TTL_S = "999999999";
// Ensure airspace stays on regardless of local .env so e2e covers it.
process.env.AIRSPACE_ENABLED = "true";

await import("./test-mocks.js");
await import("./index.js");

export {};
