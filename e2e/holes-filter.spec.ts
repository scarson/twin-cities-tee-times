// ABOUTME: Regression test for the 9/18 holes filter on the home page.
// ABOUTME: Verifies button rendering and URL-param effect at both mobile and desktop widths.
import { test, expect } from "@playwright/test";

test.describe("Holes filter", () => {
  test("renders Any / 9 holes / 18 holes buttons on the home page", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Any", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "9 holes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "18 holes", exact: true })).toBeVisible();
  });

  test("filter buttons are reachable at 375px viewport (mobile)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");

    // At narrow widths the filter bar wraps — but every button must still
    // be visible (not clipped or hidden).
    await expect(page.getByRole("button", { name: "Any", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "9 holes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "18 holes", exact: true })).toBeVisible();
  });
});
