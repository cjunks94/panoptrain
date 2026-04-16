import { test, expect } from "@playwright/test";

test.describe("Panoptrain — happy path", () => {
  test("loads the app and shows the header", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("fetches and displays live train data", async ({ page }) => {
    await page.goto("/");

    // Status badge should show Live with a non-zero train count after first poll
    const status = page.locator("text=/Live/");
    await expect(status).toBeVisible({ timeout: 30_000 });

    const count = page.locator("text=/\\d+ trains/");
    await expect(count).toBeVisible({ timeout: 30_000 });
    const countText = await count.textContent();
    const num = parseInt(countText!.match(/(\d+)/)![1], 10);
    expect(num).toBeGreaterThan(0);
  });

  test("All Off / All On filter buttons work", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // Wait for trains to load
    await expect(page.locator("text=/\\d+ trains/")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "All Off" }).click();
    await page.getByRole("button", { name: "All On" }).click();

    // App should still be functional
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("can collapse and reopen the filter panel", async ({ page }) => {
    await page.goto("/");
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

  test("trip planner finds a route between two stations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // Wait for stops to load (datalist needs to be populated)
    await expect(page.locator("text=PLAN TRIP")).toBeVisible();

    await page.getByPlaceholder("From station").fill("Times Sq-42 St");
    await page.getByPlaceholder("To station").fill("14 St");
    await page.getByRole("button", { name: "Find Route" }).click();

    // Result should appear with a "min" label and at least one stop count
    await expect(page.locator("text=/\\d+ min/").first()).toBeVisible({ timeout: 10_000 });
  });

  test("plan API returns a valid plan", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/plan?from=127&to=132");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.from.stopId).toBe("127");
    expect(body.segments.length).toBeGreaterThan(0);
  });
});
