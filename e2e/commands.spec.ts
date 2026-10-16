import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Meeting commands, Phase A (requirements-v2 C4-C6): what a signed-out visitor sees, and
 * what the routes refuse. The owner's path (spoken and typed commands on a real meeting)
 * needs a signed-in owner and is checked on a real call (plan.md).
 */
test("a visitor sees the Tasks tab as a labelled demo on a sample meeting", async ({ page }) => {
  await page.goto("/meetings/bmr007?tab=tasks");
  const tab = page.getByRole("tab", { name: /Tasks/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Examples:")).toBeVisible();
  await expect(page.getByText("AFK, task for Sam: send the deck by Friday.")).toBeVisible();
  await expect(page.getByText("Waiting for your approval")).toBeVisible();
  // Nothing can be approved or dismissed by a visitor, and nothing can be typed.
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByLabel("Didn't catch a command? Type it")).toHaveCount(0);
  await page.getByRole("button", { name: "What you can say" }).click();
  await expect(page.getByText("AFK, highlight that.").first()).toBeVisible();
  // The tab, its cards and the approval form meet the accessibility bar (NFR Accessibility).
  const scan = await new AxeBuilder({ page })
    .include("[role=tabpanel]")
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
});

test("the Send page explains what you can say", async ({ page }) => {
  await page.goto("/send");
  await expect(page.getByRole("heading", { name: "What you can say in the call" })).toBeVisible();
  await expect(page.getByText("AFK, decision: we launch on the twentieth.")).toBeVisible();
});

test("the command routes refuse anyone who isn't signed in", async ({ request }) => {
  const typed = await request.post("/api/meetings/bmr007/commands", {
    data: { text: "/decision we launch on the twentieth" },
  });
  expect(typed.status()).toBe(401);
  const approve = await request.post("/api/commands/00000000-0000-4000-8000-000000000001", {
    data: { action: "approve" },
  });
  expect(approve.status()).toBe(401);
});

test("the Tasks tab reads well at both widths", async ({ page }, testInfo) => {
  await page.goto("/meetings/bmr007?tab=tasks");
  await expect(page.getByText("Examples:")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`tasks-${testInfo.project.name}.png`),
    fullPage: false,
  });
});
