import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { addOwnedMeeting, signInAsNewUser, type TestUser } from "./signed-in";

/**
 * A meeting's address (requirement F10): the owner finds the link and the PIN on the
 * meeting page; someone else, signed out, is asked for the PIN, gets it wrong, then
 * right, and sees the recording's player, the transcript and the summary and nothing
 * of the owner's; the owner turns the link off and the page says so.
 */
test.describe("a meeting's address", () => {
  let user: TestUser | null = null;
  test.afterEach(async () => {
    await user?.dispose();
    user = null;
  });

  test("the owner passes the link and PIN on; a stranger opens it with the PIN, until the link is off", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    user = await signInAsNewUser(context, baseURL!);
    const meetingId = await addOwnedMeeting(user.id);
    await page.goto(`/meetings/${meetingId}`);
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });

    // The Share panel: the address and the PIN, the owner's alone.
    await page.locator('summary[aria-label="Share this meeting"]').click();
    const panel = page.getByText("Anyone with the link and the PIN").locator("..");
    const url = await panel.getByLabel("Link").inputValue();
    expect(url).toMatch(/\/m\/[a-z0-9]{12}$/);
    const pin = (await panel.getByLabel(/^PIN \d{4}$/).getAttribute("aria-label"))!.slice(4);
    expect(pin).toMatch(/^\d{4}$/);

    // Someone else, not signed in: the PIN first, wrong then right.
    const stranger = await browser.newContext();
    const viewer = await stranger.newPage();
    await viewer.goto(url);
    await expect(
      viewer.getByRole("heading", { level: 1, name: "A meeting shared with you" }),
    ).toBeVisible();
    const wrong = pin === "0000" ? "0001" : "0000";
    await viewer.getByLabel("PIN").fill(wrong);
    await viewer.getByRole("button", { name: "Open the meeting" }).click();
    await expect(viewer.getByText(/4 tries left/)).toBeVisible();
    await viewer.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-meeting-link-pin.png`,
      fullPage: true,
    });
    await viewer.getByLabel("PIN").fill(pin);
    await viewer.getByRole("button", { name: "Open the meeting" }).click();
    await expect(
      viewer.getByRole("heading", { level: 1, name: "Launch planning (test)" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(viewer.getByText("Shared with you")).toBeVisible();
    await expect(viewer.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
    // The summary's place, then the transcript (behind its toggle on a phone); nothing of
    // the owner's and no way in.
    await expect(viewer.getByText(/No summary was written/)).toBeVisible();
    const transcriptToggle = viewer.getByRole("button", { name: "Transcript" });
    if (await transcriptToggle.isVisible()) await transcriptToggle.click();
    await expect(viewer.getByText("Let's settle the launch date today.")).toBeVisible();
    await expect(viewer.getByRole("tab")).toHaveCount(0);
    await expect(viewer.locator('a[href*="/meetings/"]')).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: /Highlight/ })).toHaveCount(0);
    await viewer.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-meeting-link.png`,
    });
    const scan = await new AxeBuilder({ page: viewer })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    // The grant holds across a reload, without the PIN again.
    await viewer.reload();
    await expect(
      viewer.getByRole("heading", { level: 1, name: "Launch planning (test)" }),
    ).toBeVisible({
      timeout: 20_000,
    });

    // The owner turns the link off: the viewer's next visit is refused.
    await page.getByRole("button", { name: "Turn the link off" }).click();
    await expect(page.getByText("Link is off")).toBeVisible();
    await viewer.reload();
    await expect(
      viewer.getByRole("heading", { level: 1, name: "This meeting isn't available" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await stranger.close();
  });
});
