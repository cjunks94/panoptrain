import { test, expect } from "@playwright/test";

test.describe("Mobile — core functionality", () => {
  test("app loads and renders at mobile viewport", async ({ page }) => {
    await page.goto("/");

    // Map canvas should fill the viewport
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(300);
    expect(box!.height).toBeGreaterThan(400);
  });

  test("filter panel opens and closes cleanly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // Close panel
    await page.getByRole("button", { name: "×" }).click();
    await expect(page.getByRole("button", { name: "Filter Lines" })).toBeVisible();

    // Map should still be visible underneath
    await expect(page.locator("canvas")).toBeVisible();

    // Reopen
    await page.getByRole("button", { name: "Filter Lines" }).click();
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
  });

  test("train data loads on mobile", async ({ page }) => {
    await page.goto("/");
    const count = page.locator("text=/\\d+ trains/");
    await expect(count).toBeVisible({ timeout: 30_000 });
  });

  test("trip planner is accessible on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=PLAN TRIP")).toBeVisible();
    await expect(page.getByPlaceholder("From station")).toBeVisible();
    await expect(page.getByPlaceholder("To station")).toBeVisible();

    // Inputs should be tappable (not clipped by panel width)
    const input = page.getByPlaceholder("From station");
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
  });

  test("all filter toggles are visible and scrollable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

    // All On / All Off buttons should be visible
    await expect(page.getByRole("button", { name: "All On" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All Off" })).toBeVisible();

    // At least one line toggle should exist
    await expect(page.locator("text=1 2 3").first()).toBeVisible();
  });

  test("no horizontal overflow on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

    // Check that the page doesn't scroll horizontally
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
  });
});
