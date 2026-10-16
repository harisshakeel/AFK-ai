import { readFileSync } from "node:fs";

import { test } from "@playwright/test";

/**
 * Renders an HTML file to a PNG, for checking marks and exporting brand assets. Opt in:
 *
 *   BASE_URL=http://127.0.0.1:9 RENDER_HTML=/path/in.html RENDER_PNG=/path/out.png \
 *     pnpm e2e e2e/render-svg.spec.ts --project=desktop
 *
 * BASE_URL (any value) stops Playwright starting the dev server; nothing is fetched.
 * RENDER_WIDTH / RENDER_HEIGHT set the viewport; RENDER_TRANSPARENT=1 omits the page
 * background (a transparent PNG); RENDER_SCALE sets the device scale factor (2 = retina).
 */
test("render an HTML file to a PNG", async ({ browser }) => {
  const src = process.env.RENDER_HTML;
  const out = process.env.RENDER_PNG;
  test.skip(!src || !out, "set RENDER_HTML and RENDER_PNG to render");
  const context = await browser.newContext({
    viewport: {
      width: Number(process.env.RENDER_WIDTH ?? 1200),
      height: Number(process.env.RENDER_HEIGHT ?? 800),
    },
    deviceScaleFactor: Number(process.env.RENDER_SCALE ?? 1),
  });
  const page = await context.newPage();
  await page.setContent(readFileSync(src!, "utf8"), { waitUntil: "load" });
  // Web fonts named in the file (the wordmark export) must be in before the capture.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: out!,
    fullPage: true,
    omitBackground: process.env.RENDER_TRANSPARENT === "1",
  });
  await context.close();
});
