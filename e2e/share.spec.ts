import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F6 + F7: highlight a moment, share it, open the link as someone else (signed out),
// then turn the link off. Each test gets a fresh browser context, so the second
// visitor really is a different, signed-out person.
test("a shared clip plays only that clip for a signed-out viewer, until the link is turned off", async ({
  page,
  browser,
  context,
}) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/meetings/bro015?t=60");
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });

  // Highlight from the playhead (H), then share it.
  await page.keyboard.press("h");
  // The first write also creates the visitor's identity (and loads the Supabase client),
  // which against a cold deployment can take several seconds.
  await expect(page.getByText(/^Highlighted \d+ s$/)).toBeVisible({ timeout: 15_000 });
  const highlights = page.getByRole("tabpanel");
  await highlights.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/Link copied/)).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/share\/[0-9a-f]{64}$/);

  // Someone else, not signed in, opens it.
  const stranger = await browser.newContext();
  const viewer = await stranger.newPage();
  await viewer.goto(link);
  await expect(viewer.getByText("A clip shared with you")).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Play clip" })).toBeVisible();
  await expect(
    viewer.getByRole("region", { name: "What was said" }).getByRole("listitem").first(),
  ).toBeVisible();
  // Nothing links back into the rest of the meeting, and none of the owner's commands or
  // memory is on the page (NFR Memory privacy).
  await expect(viewer.locator('a[href*="/meetings/"]')).toHaveCount(0);
  await expect(viewer.getByRole("tab")).toHaveCount(0);
  await expect(viewer.getByText(/Tasks|AFK heard|What AFK knows/)).toHaveCount(0);
  // The share page meets the accessibility bar too (NFR Accessibility).
  const scan = await new AxeBuilder({ page: viewer })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);

  // The owner turns the link off; the stranger now gets the clear unavailable page.
  await highlights.getByRole("button", { name: "Turn off link" }).click();
  await expect(page.getByText(/Link turned off/)).toBeVisible();
  await viewer.reload();
  await expect(viewer.getByRole("heading", { name: "This clip isn't available" })).toBeVisible();

  // A made-up token gets the same page.
  await viewer.goto(`/share/${"0".repeat(64)}`);
  await expect(viewer.getByRole("heading", { name: "This clip isn't available" })).toBeVisible();
  await stranger.close();
});

test("ticks are private to each visitor and survive a refresh", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto("/meetings/bmr007?tab=actions");
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
  const first = page.getByRole("checkbox").first();
  // Registered before the click: the save can finish before the next line otherwise.
  const saved = page.waitForResponse(
    (response) => response.url().includes("/state") && response.ok(),
  );
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await saved;
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true");

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/meetings/bmr007?tab=actions");
  await expect(otherPage.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "false");
  await other.close();
});
