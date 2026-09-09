import { test, expect, type Page, type Response } from "@playwright/test";

/**
 * Map-loaded assertions (#182).
 *
 * The maplibre-gl 4 -> 6 bump (#167) shipped a black map for days while CI
 * stayed green: the tile worker 404'd (only in the production bundle) and
 * `load` never fired (also on the dev server), so no train layer ever
 * mounted. Nothing here asserted that the map actually finished loading.
 *
 * These tests pin the three signals that would have caught it, in the
 * order they fail:
 *   1. the maplibre worker chunk is served as JavaScript (the regression
 *      served index.html via the SPA fallback);
 *   2. the basemap requested at least one vector tile;
 *   3. `load` fired and the `train-markers` layer is drawing features.
 *
 * Signals 1-2 are network observations; signal 3 reads the explicit hook
 * TransitMap registers in its onLoad handler (`window.__panoptrain`), not
 * React internals. Run this file against both the dev server and the
 * production build (`pnpm test:e2e:prod`) — regression 1 only reproduces
 * on the latter.
 */

// maplibre's `load` waits on every source, so it lands only after the
// basemap tiles, glyphs, and the route/stop GeoJSON have all arrived. Under
// headless SwiftShader with parallel workers sharing one CARTO connection
// pool that measured ~26s on desktop chromium locally; the test timeout has
// to clear it with margin or it fires before the assertion does.
const MAP_LOAD_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_MS = 60_000;

declare global {
  interface Window {
    __panoptrain?: {
      mapReady: () => boolean;
      renderedFeatures: (layerId: string) => number | null;
    };
  }
}

function isWorkerChunk(res: Response): boolean {
  return /maplibre-gl-worker/.test(res.url());
}

function isVectorTile(res: Response): boolean {
  // The dark-matter style's tiles.json fans tiles out across
  // tiles-{a,b,c,d}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt.
  // Glyphs live under /fonts/ as .pbf, so match the tile path, not the host.
  return /basemaps\.cartocdn\.com\/vectortiles\/.*\/\d+\/\d+\/\d+\.mvt/.test(res.url());
}

async function waitForMapReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__panoptrain?.mapReady() === true, undefined, {
    timeout: MAP_LOAD_TIMEOUT_MS,
  });
}

test.describe("Map — finishes loading and draws trains", () => {
  test.describe.configure({ timeout: TEST_TIMEOUT_MS });

  test("serves the maplibre worker as JavaScript, not the SPA fallback", async ({ page }) => {
    // Register before navigation so the first (and only) worker fetch is
    // not missed.
    const worker = page.waitForResponse(isWorkerChunk, { timeout: MAP_LOAD_TIMEOUT_MS });
    await page.goto("/");
    const res = await worker;

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toMatch(/javascript/);
  });

  test("requests basemap vector tiles", async ({ page }) => {
    const tile = page.waitForResponse(isVectorTile, { timeout: MAP_LOAD_TIMEOUT_MS });
    await page.goto("/");
    const res = await tile;
    expect(res.ok()).toBe(true);
  });

  test("fires load and mounts the train-markers layer with rendered features", async ({ page }) => {
    await page.goto("/");
    await waitForMapReady(page);

    // The layer mounts on the render after `load` and symbol placement runs
    // a frame or two later, so poll rather than read once. Fixture trains
    // sit inside the default NYC viewport, so a healthy map draws dozens.
    await page.waitForFunction(
      () => (window.__panoptrain?.renderedFeatures("train-markers") ?? 0) > 0,
      undefined,
      { timeout: MAP_LOAD_TIMEOUT_MS },
    );
    const rendered = await page.evaluate(() => window.__panoptrain!.renderedFeatures("train-markers"));
    expect(rendered).toBeGreaterThan(0);
  });
});
