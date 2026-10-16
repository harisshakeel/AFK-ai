import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F1: the meetings list is never empty and opens a meeting in one click.
test("the meetings list shows the seed meetings and passes the accessibility scan", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/samples");
  await expect(page.getByRole("heading", { level: 1, name: "Sample meetings" })).toBeVisible();
  // The long meeting is there with its length and speakers.
  const long = page.getByRole("link", { name: /Meeting Recorder project meeting.*Nov 9, 2000/ });
  await expect(long).toContainText("1 hr");
  await expect(long).toContainText("8 speakers");

  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("one click opens a meeting", async ({ page }) => {
  await page.goto("/samples");
  await page.getByRole("link", { name: /Nov 9, 2000/ }).click();
  // The dev server compiles the meeting page on first use, which can take a while.
  await expect(page).toHaveURL(/\/meetings\/bmr007$/, { timeout: 45_000 });
  // The URL changes while the page still streams behind its loading skeleton.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Meeting Recorder project meeting",
    { timeout: 45_000 },
  );
});
