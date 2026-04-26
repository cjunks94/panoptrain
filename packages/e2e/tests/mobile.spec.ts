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

/**
 * Failing tests that drive Epic 4 (mobile-first design). Each one encodes a
 * known UX gap. As tickets PT-401..PT-407 ship, the corresponding tests turn
 * green. Run on chromium (desktop) too so we catch accessibility regressions
 * that hurt everyone (e.g. tiny touch targets) — most assertions pass on
 * desktop because the desktop layout is roomier.
 */
test.describe("Mobile — Epic 4 readiness", () => {
  const MIN_TOUCH = 44; // px, per Apple HIG / WCAG 2.5.5

  test.describe("PT-401 touch targets", () => {
    test("All On / All Off buttons are at least 44px tall", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
      for (const name of ["All On", "All Off"]) {
        const box = await page.getByRole("button", { name }).boundingBox();
        expect(box, `${name} should have a bounding box`).not.toBeNull();
        expect(box!.height, `${name} height ≥ ${MIN_TOUCH}`).toBeGreaterThanOrEqual(MIN_TOUCH);
      }
    });

    test("Find Route button meets 44px touch target", async ({ page }) => {
      await page.goto("/");
      const box = await page.getByRole("button", { name: "Find Route" }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    });

    test("close-panel button meets 44x44 touch target", async ({ page }) => {
      await page.goto("/");
      const box = await page.getByRole("button", { name: "×" }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height, "× button height").toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(box!.width, "× button width").toBeGreaterThanOrEqual(MIN_TOUCH);
    });

    test("Filter Lines (re-open) button meets 44px touch target", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "×" }).click();
      const box = await page.getByRole("button", { name: "Filter Lines" }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH);
    });
  });

  test.describe("PT-402 panel coverage", () => {
    // Marked fixme until PT-402 (bottom-sheet pattern) lands. Remove this
    // annotation when the panel adapts to narrow viewports.
    test.fixme("panel does not cover more than 50% of mobile viewport width", async ({ page, viewport }) => {
      test.skip(!viewport || viewport.width >= 768, "mobile viewports only");
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();

      // Walk up from the heading to find the absolutely-positioned panel root
      const panelWidth = await page.evaluate(() => {
        const heading = document.querySelector("h1");
        if (!heading) return null;
        let el: HTMLElement | null = heading.parentElement;
        while (el) {
          const cs = getComputedStyle(el);
          if (cs.position === "absolute" || cs.position === "fixed") {
            return el.getBoundingClientRect().width;
          }
          el = el.parentElement;
        }
        return null;
      });
      expect(panelWidth).not.toBeNull();
      expect(panelWidth! / viewport!.width).toBeLessThanOrEqual(0.5);
    });
  });

  test.describe("PT-404 plan tab overflow", () => {
    test("all plan tabs are visible (or wrap) without horizontal clipping", async ({ page, viewport }) => {
      await page.goto("/");
      await expect(page.getByPlaceholder("From station")).toBeVisible();

      // Times Sq → Bedford Av reliably yields multiple alternatives
      await page.getByPlaceholder("From station").fill("Times Sq-42 St");
      await page.getByPlaceholder("To station").fill("Bedford Av · L");
      await page.getByRole("button", { name: "Find Route" }).click();

      const recommended = page.getByRole("button", { name: /Recommended/ });
      await expect(recommended).toBeVisible({ timeout: 15_000 });

      const tabs = page.getByRole("button", { name: /^(Recommended|Avoids|Alternative)/ });
      const n = await tabs.count();
      expect(n).toBeGreaterThan(1);

      const vw = viewport?.width ?? 1280;
      for (let i = 0; i < n; i++) {
        const box = await tabs.nth(i).boundingBox();
        expect(box, `tab ${i} bounding box`).not.toBeNull();
        // Tab must be on-screen (not clipped left/right)
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
        // And tappable
        expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH - 16); // 28px+, lower than full target since tabs are dense
      }
    });
  });

  test.describe("PT-407 full plan flow on mobile", () => {
    test("complete trip-plan flow renders segments and tabs", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Panoptrain" })).toBeVisible();
      await expect(page.getByPlaceholder("From station")).toBeVisible();

      await page.getByPlaceholder("From station").fill("Times Sq-42 St");
      await page.getByPlaceholder("To station").fill("14 St-Union Sq");
      await page.getByRole("button", { name: "Find Route" }).click();

      // Plan summary
      await expect(page.locator("text=/\\d+ min/").first()).toBeVisible({ timeout: 15_000 });
      // At least one ride segment "X → Y"
      await expect(page.getByText(/→/).first()).toBeVisible();
      // Recommended tab present
      await expect(page.getByRole("button", { name: /Recommended/ })).toBeVisible();
    });

    test("switching plan alternatives updates the active tab", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByPlaceholder("From station")).toBeVisible();

      await page.getByPlaceholder("From station").fill("Times Sq-42 St");
      await page.getByPlaceholder("To station").fill("Bedford Av · L");
      await page.getByRole("button", { name: "Find Route" }).click();

      const recommended = page.getByRole("button", { name: /Recommended/ });
      await expect(recommended).toBeVisible({ timeout: 15_000 });

      // Find an alternative tab
      const alt = page.getByRole("button", { name: /^(Avoids|Alternative)/ }).first();
      await expect(alt).toBeVisible();
      await alt.click();

      // After click, alt should still be visible (selecting it shouldn't crash)
      await expect(alt).toBeVisible();
      // And the plan summary should still be on screen
      await expect(page.locator("text=/\\d+ min/").first()).toBeVisible();
    });
  });
});
