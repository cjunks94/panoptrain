import { test, expect } from "@playwright/test";

test.describe("Panoptrain — happy path", () => {
  test("loads the app and shows the header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("fetches and displays live train data", async ({ page }) => {
    await page.goto("/");

    // 15s timeout (was 5s) — globalSetup guarantees the server has trains
    // before this runs, but mobile-viewport CPU throttle can still slow
    // the client's first render past the original 5s window (#111). The
    // regex requires a leading non-zero digit so the locator actually
    // waits for data to land instead of matching the initial-state
    // "0 trains" placeholder.
    const status = page.locator("text=/Live/");
    await expect(status).toBeVisible({ timeout: 15_000 });

    const count = page.locator("text=/[1-9]\\d* trains/");
    await expect(count).toBeVisible({ timeout: 15_000 });
    const countText = await count.textContent();
    const num = parseInt(countText!.match(/(\d+)/)![1], 10);
    expect(num).toBeGreaterThan(0);
  });

  test("All Off / All On filter buttons work", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // 15s timeout (#111) — see "fetches and displays live train data" above.
    await expect(page.locator("text=/[1-9]\\d* trains/")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "All Off" }).click();
    await page.getByRole("button", { name: "All On" }).click();

    // App should still be functional
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("can collapse and reopen the filter panel", async ({ page, viewport }) => {
    await page.goto("/");
    // Mobile defaults the bottom sheet closed (so users land on the map);
    // desktop defaults the sidebar open. Normalize to open before the
    // collapse/reopen flow so this test runs identically across viewports.
    const isMobile = (viewport?.width ?? 1280) < 768;
    if (isMobile) {
      await page.getByRole("button", { name: "Filter Lines" }).click();
    }
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // Close the panel via the × button
    await page.getByRole("button", { name: "×" }).click();

    // "Filter Lines" button should appear
    await expect(page.getByRole("button", { name: "Filter Lines" })).toBeVisible();

    // Reopen
    await page.getByRole("button", { name: "Filter Lines" }).click();
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("server health endpoint responds", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("trains API returns data", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/trains");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.trains)).toBe(true);
    expect(body.count).toBeGreaterThan(0);
  });

  test("trip planner UI renders with station inputs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=PLAN TRIP")).toBeVisible();
    await expect(page.getByPlaceholder("From station")).toBeVisible();
    await expect(page.getByPlaceholder("To station")).toBeVisible();
    await expect(page.getByRole("button", { name: "Find Route" })).toBeVisible();
  });

  test("plan API returns at least a primary plan", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/plan?from=127&to=132");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.plans[0].from.stopId).toBe("127");
    expect(body.plans[0].label).toBe("Recommended");
    expect(body.plans[0].segments.length).toBeGreaterThan(0);
  });
});
