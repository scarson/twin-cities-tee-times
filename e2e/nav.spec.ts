// ABOUTME: Regression test for the responsive nav — catches header overflow at narrow viewports.
// ABOUTME: Prior bug: at 375px, "Sign in" wrapped onto two lines and logos collided with Courses.
import { test, expect } from "@playwright/test";

test.describe("Nav responsive layout", () => {
  test("at 375px viewport: Sign in renders single-line and nav fits width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");

    const signIn = page.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();

    // Single-line "Sign in" is ~20px at text-sm; wrapped onto two lines is ~40px.
    // 30px threshold is well-separated from both states.
    const box = await signIn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(30);

    // Nav must not introduce horizontal overflow at the viewport width.
    const navScrollWidth = await page
      .locator("nav")
      .evaluate((el) => el.scrollWidth);
    expect(navScrollWidth).toBeLessThanOrEqual(375);
  });
});
