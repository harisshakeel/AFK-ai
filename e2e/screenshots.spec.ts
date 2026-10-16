import { test } from "@playwright/test";

/**
 * Captures full-page screenshots for visual review. Opt in with SCREENSHOTS=1 so the
 * normal run stays fast:  SCREENSHOTS=1 pnpm e2e --grep screenshots
 * Files land in test-results/screenshots/<project>-<name>.png
 */
const pages: Array<{ name: string; path: string }> = [
  { name: "home", path: "/" },
  { name: "samples", path: "/samples" },
  { name: "meeting", path: "/meetings/bmr007?t=1838" },
  { name: "meeting-actions", path: "/meetings/bmr007?tab=actions" },
  { name: "meeting-chapters", path: "/meetings/bmr007?tab=chapters&t=900" },
  { name: "search", path: "/search?q=overlap" },
  { name: "send", path: "/send" },
  { name: "sign-in", path: "/sign-in" },
  { name: "share-unavailable", path: `/share/${"0".repeat(64)}` },
  { name: "memory-demo", path: "/memory" },
  { name: "welcome-preview", path: "/welcome?preview=1" },
  { name: "not-found", path: "/meetings/does-not-exist" },
];

test.describe("screenshots", () => {
  test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to capture");

  for (const { name, path } of pages) {
    test(name, async ({ page }, info) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `test-results/screenshots/${info.project.name}-${name}.png`,
        fullPage: !path.startsWith("/meetings/"),
      });
    });
  }
});
