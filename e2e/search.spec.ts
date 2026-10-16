import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F8: search across meetings, grouped, opening at the moment with the term highlighted.
test("finds where something was said and opens the meeting at that moment", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/samples");
  await page.getByRole("searchbox", { name: "Search all meetings" }).fill("seat number");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=seat\+number/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("seat number");
  // Each meeting shows spoken lines (with the speaker) as well as what the notes say.
  const firstGroup = page.locator("main ol > li").first();
  await expect(firstGroup.getByText(/^Speaker [A-H]$/).first()).toBeVisible();
  // The results page meets the accessibility bar (NFR Accessibility).
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  const spokenHit = firstGroup
    .locator("ul a")
    .filter({ hasText: /Speaker [A-H]/ })
    .first();
  await expect(spokenHit.locator("mark").first()).toBeVisible();
  // A spoken hit names its moment (F8: snippet, speaker and time).
  await expect(spokenHit.getByText(/^\d+:\d\d(?::\d\d)?$/)).toBeVisible();
  await spokenHit.click();
  await expect(page).toHaveURL(/\/meetings\/[a-z0-9-]+\?.*q=seat/);
  await expect(page).toHaveURL(/[?&]t=\d/);
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
  // It opens on the line that was said, with the term marked in it, and the find box
  // starts at that match rather than the meeting's first one.
  const current = page.locator('li[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current.locator("mark").first()).toBeVisible();
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024) {
    await expect(page.getByRole("button", { name: "Transcript" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  await expect(page.getByText(/^\d+ of \d+$/)).toBeVisible();
});

test("a search with no results suggests what to do next", async ({ page }) => {
  await page.goto("/search?q=zebracornflakes");
  await expect(page.getByRole("heading", { name: /Nothing matched/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "browse the meetings" })).toBeVisible();
});
