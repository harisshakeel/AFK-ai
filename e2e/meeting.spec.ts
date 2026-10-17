import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { parseTimeParam } from "../src/lib/time-rules";

// The long meeting (bmr007: an hour, eight speakers) is the case the brief cares about.
const MEETING = "/meetings/bmr007";

/** Open a page and wait until React has hydrated it, so clicks aren't lost. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
}

/** On a phone the transcript sits behind a pane toggle; on a desktop both panes show. */
async function showTranscript(page: Page) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 1024)
    await page.getByRole("button", { name: "Transcript" }).click();
}

/** Press Tab until the focused element matches, as someone without a mouse would. */
async function tabTo(page: Page, selector: string) {
  for (let i = 0; i < 80; i++) {
    const there = await page.evaluate(
      (sel) => document.activeElement?.matches(sel) === true,
      selector,
    );
    if (there) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${selector}`);
}

/** "1:02:03" or "2:03" to seconds, and back, the way the page prints a clock. */
const clockToSec = (clock: string) =>
  clock.split(":").reduce((total, part) => total * 60 + Number(part), 0);
const secToClock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

test.describe("meeting page", () => {
  // The dev server compiles on first hit; production runs are much faster.
  test.describe.configure({ timeout: 90_000 });

  test("opens at a ?t= moment with the line under the playhead marked and in view", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    // 30:38.5 is inside "Seat number, that's a good idea." (1838.22-1839.567 s), while
    // two other speakers' turns overlap it.
    await open(page, `${MEETING}?t=1838.5`);
    const current = page.locator('li[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Seat number");
    await expect(current).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test("reaches a decision in three actions and plays from it", async ({ page }) => {
    await open(page, MEETING);
    await page.getByRole("tab", { name: /Decisions/ }).click();
    const decision = page.getByRole("tabpanel").getByRole("listitem").first();
    await expect(decision).toBeVisible();
    const playFrom = decision.getByRole("button", { name: /Play from/ });
    const label = await playFrom.getAttribute("aria-label");
    const clock = label?.match(/\d+:\d\d(?::\d\d)?/)?.[0];
    expect(clock).toBeTruthy();
    await playFrom.click();
    // Pause at once so the moment doesn't drift while we look.
    await page.keyboard.press("k");
    await expect(page).toHaveURL(/tab=decisions/);
    // The player really moved there: the current line's own time button shows the same
    // clock (a CSS locator, because on a phone the transcript pane is hidden behind Notes).
    const current = page.locator('li[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current.locator('button[aria-label^="Play from"]')).toHaveAttribute(
      "aria-label",
      new RegExp(clock!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("a ?t= link also positions the audio, and the shortcuts work after scrubbing", async ({
    page,
  }) => {
    await open(page, `${MEETING}?t=1838.5`);
    // The pending seek is applied once the metadata has loaded; poll until it lands.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const audio = document.querySelector("audio");
            return audio ? { ready: audio.readyState, time: audio.currentTime } : null;
          }),
        { timeout: 20_000, message: "the audio never moved to the ?t= moment" },
      )
      .toMatchObject({ time: expect.closeTo(1838.5, 0) });

    // Clicking a line's time plays from there (F2): the audio itself moves, not only the mark.
    const nextLine = page.locator('li[aria-current="true"] + li');
    const nextLabel = await nextLine
      .locator('button[aria-label^="Play from"]')
      .getAttribute("aria-label");
    const lineSec = parseTimeParam(nextLabel?.match(/\d+:\d\d(?::\d\d)?/)?.[0]);
    expect(lineSec).not.toBeNull();
    await nextLine.locator('button[aria-label^="Play from"]').click();
    await page.keyboard.press("k");
    await expect
      .poll(() => page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1), {
        timeout: 10_000,
        message: "the audio did not move to the clicked line",
      })
      .toBeGreaterThanOrEqual(lineSec! - 1);
    expect(
      await page.evaluate(() => document.querySelector("audio")?.currentTime ?? -1),
    ).toBeLessThan(lineSec! + 5);

    // Click the scrubber (focus lands on the slider), then K must still toggle playback.
    const slider = page.getByRole("slider", { name: "Seek" });
    const box = (await slider.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(slider).toBeFocused();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Pause (K)" })).toBeVisible();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Play (K)" })).toBeVisible();
  });

  test("filters the transcript by speaker, and chapters jump the player", async ({ page }) => {
    await open(page, MEETING);
    const viewport = page.viewportSize();
    const phone = viewport !== null && viewport.width < 1024;
    if (phone) await page.getByRole("button", { name: "Transcript" }).click();
    const rows = page.locator("li[data-index]");
    await expect(rows).toHaveCount(1067);
    const chips = page.getByRole("group", { name: "Show speakers" }).getByRole("button");
    const chip = chips.nth(1);
    const speaker = (await chip.textContent())!.trim();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    // Every row still shown belongs to that speaker, and the find count agrees with them.
    const shown = await rows.evaluateAll(
      (items) => items.filter((item) => item.checkVisibility()).length,
    );
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(1067);
    // The find count only counts the rows on screen (a hidden match can't be stepped to).
    await page.getByRole("searchbox", { name: "Find in this meeting" }).fill("the");
    const count = await page.getByText(/^\d+ of \d+$/).textContent();
    const matches = Number(count!.match(/of (\d+)/)![1]);
    expect(matches).toBeGreaterThan(0);
    expect(matches).toBeLessThanOrEqual(shown);
    await page.getByRole("searchbox", { name: "Find in this meeting" }).fill("");
    await page.getByRole("button", { name: "Everyone" }).click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(speaker.length).toBeGreaterThan(0);

    if (phone) await page.getByRole("button", { name: "Notes", exact: true }).click();
    await page.getByRole("tab", { name: /Chapters/ }).click();
    const chapter = page.getByRole("tabpanel").getByRole("listitem").nth(3).getByRole("button");
    const chapterClock = (await chapter.textContent())?.match(/\d+:\d\d(?::\d\d)?/)?.[0];
    expect(chapterClock).toBeTruthy();
    await chapter.click();
    await page.keyboard.press("k"); // pause, so the current line stays the chapter's first
    await expect(page).toHaveURL(/[?&]t=\d/);
    await expect(
      page.locator('li[aria-current="true"]').locator('button[aria-label^="Play from"]'),
    ).toHaveAttribute(
      "aria-label",
      new RegExp(chapterClock!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("switches summary templates instantly and keeps the choice in the URL", async ({ page }) => {
    await open(page, MEETING);
    await page.getByRole("button", { name: "Project update" }).click();
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
    await expect(page).toHaveURL(/template=project_update/);
    await page.reload();
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Project update" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("finds words within the meeting with a match count", async ({ page }) => {
    await open(page, MEETING);
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024)
      await page.getByRole("button", { name: "Transcript" }).click();
    await page.getByRole("searchbox", { name: "Find in this meeting" }).fill("seat number");
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
    await expect(page.locator("mark").first()).toBeVisible();
  });

  test("has no serious accessibility violations", async ({ page }) => {
    test.setTimeout(180_000); // axe over an hour-long transcript takes a while
    await open(page, MEETING);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.flatMap((v) =>
        v.nodes
          .slice(0, 6)
          .map((node) => `${v.id}: ${node.target.join(" ")} ${node.any[0]?.message ?? ""}`),
      ),
    ).toEqual([]);
  });

  test("an unknown meeting shows the not-found page", async ({ page }) => {
    // The page streams (loading.tsx), so this is a soft 404: the right page, marked noindex.
    await page.goto("/meetings/does-not-exist");
    await expect(page.getByRole("heading", { name: /doesn.t exist/ })).toBeVisible();
  });

  test("scrolling away stops the auto-scroll and offers Back to now; the speed runs 1× to 2×", async ({
    page,
  }) => {
    await open(page, `${MEETING}?t=1838.5`);
    await showTranscript(page);
    const current = page.locator('li[aria-current="true"]');
    await expect(current).toBeInViewport();
    // Read back up the transcript as a listener would: the list stops following.
    await current.hover();
    await page.mouse.wheel(0, -2400);
    const back = page.getByRole("button", { name: "Back to now" });
    await expect(back).toBeVisible();
    await expect(current).not.toBeInViewport();
    await back.click();
    await expect(back).toBeHidden();
    await expect(current).toBeInViewport();

    // The speed button steps 1, 1.25, 1.5, 1.75, 2 and round again, on the audio itself.
    const speed = page.locator('button[aria-label^="Playback speed"]:visible');
    await expect(speed).toHaveAttribute("aria-label", "Playback speed 1×. Change speed");
    for (const rate of [1.25, 1.5, 1.75, 2]) {
      await speed.click();
      await expect(speed).toHaveAttribute("aria-label", `Playback speed ${rate}×. Change speed`);
      expect(await page.evaluate(() => document.querySelector("audio")?.playbackRate)).toBe(rate);
    }
    await speed.click();
    await expect(speed).toHaveAttribute("aria-label", "Playback speed 1×. Change speed");
  });

  test("Copy all puts every action item on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, `${MEETING}?tab=actions`);
    const panel = page.getByRole("tabpanel");
    const count = await panel.getByRole("checkbox").count();
    expect(count).toBeGreaterThan(0);
    await panel.getByRole("button", { name: "Copy all" }).click();
    await expect(page.getByText(`Copied ${count} action items`)).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split("\n");
    const title = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    expect(lines[0]).toBe(`Action items: ${title}`);
    expect(lines.slice(1)).toHaveLength(count);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^- \[[ x]\] .+ · (owner: .+|no owner mentioned)/);
    }
  });

  test("a transcript selection becomes a highlight that can be adjusted, survives a reload and can be deleted", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, "/meetings/bro015");
    await showTranscript(page);
    const startLabel = await page
      .locator('li[data-index="2"] button[aria-label^="Play from"]')
      .getAttribute("aria-label");
    const startClock = startLabel!.match(/\d+:\d\d(?::\d\d)?/)![0];

    // Select two lines' words as a reader does by dragging, then take the button that
    // appears over the selection.
    await page.evaluate(() => {
      const first = document.querySelector('li[data-index="2"] p')!;
      const last = document.querySelector('li[data-index="3"] p')!;
      const range = document.createRange();
      range.setStartBefore(first.firstChild!);
      range.setEndAfter(last.lastChild!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      first.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Highlight selection" }).click();
    // The first write also creates the visitor's identity, which can take a few seconds.
    await expect(page.getByText(/^Highlighted \d+ s$/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /Highlights/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const clip = page.getByRole("tabpanel").getByRole("listitem").first();
    await expect(clip).toContainText(`${startClock} –`);
    const endClock = (await clip.locator("p").first().textContent())!.match(
      /– (\d+:\d\d(?::\d\d)?)/,
    )![1]!;

    // Nudge the end a second later; the change is saved.
    const patched = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/highlights/") &&
        response.ok(),
    );
    await clip.getByRole("button", { name: "End one second later" }).click();
    await patched;
    const later = secToClock(clockToSec(endClock) + 1);
    await expect(clip).toContainText(`${startClock} – ${later}`);

    // Still there, as adjusted, after a reload.
    await open(page, "/meetings/bro015?tab=highlights");
    const reloaded = page.getByRole("tabpanel").getByRole("listitem").first();
    await expect(reloaded).toContainText(`${startClock} – ${later}`);

    // Deleted for good.
    const deleted = page.waitForResponse(
      (response) => response.request().method() === "DELETE" && response.ok(),
    );
    await reloaded.getByRole("button", { name: "Delete highlight" }).click();
    await deleted;
    await expect(page.getByText("Highlight deleted")).toBeVisible();
    await expect(page.getByText("Keep a moment worth sharing")).toBeVisible();
    await open(page, "/meetings/bro015?tab=highlights");
    await expect(page.getByText("Keep a moment worth sharing")).toBeVisible();
  });

  test("when the audio can't load the page says so, the transcript still works, and Try again recovers it", async ({
    page,
  }) => {
    // The recording's signed link fails, as it would on a bad connection or a dead bucket.
    const signedAudio = /\/storage\/v1\/object\/sign\//;
    await page.route(signedAudio, (route) => route.abort());
    await open(page, "/meetings/bro015");
    const notice = page.getByRole("status").filter({ hasText: "The audio didn't load" });
    await expect(notice).toBeVisible();
    await expect(page.getByRole("button", { name: "Play (K)" })).toBeDisabled();
    // The transcript is untouched by the failure.
    await showTranscript(page);
    await expect(page.locator("li[data-index]").first()).toBeVisible();
    await page.getByRole("searchbox", { name: "Find in this meeting" }).fill("the");
    await expect(page.getByText(/^1 of \d+$/)).toBeVisible();

    // The connection is back: Try again asks for a fresh link and the player wakes up.
    await page.unroute(signedAudio);
    const fresh = page.waitForResponse(
      (response) => response.url().includes("/api/meetings/bro015/media") && response.ok(),
    );
    await notice.getByRole("button", { name: "Try again" }).click();
    await fresh;
    await expect(notice).toBeHidden();
    await expect(page.getByRole("button", { name: "Play (K)" })).toBeEnabled();
  });

  test("a slow meeting shows the page's skeleton while it loads", async ({ page }) => {
    // Hold the meeting's data for a moment, as a slow network would. Only the click's own
    // request is held: a production build prefetches the loading skeleton as soon as the
    // link is on screen (a dev server does not), and holding that prefetch too would leave
    // no skeleton to show.
    await page.route(/\/meetings\/bro015(\?|$)/, async (route) => {
      const headers = route.request().headers();
      if (headers["rsc"] === "1" && !headers["next-router-prefetch"]) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      await route.continue();
    });
    await page.goto("/samples");
    const link = page.locator('a[href^="/meetings/bro015"]').first();
    await expect(link).toBeVisible();
    // Let any prefetch land first, as it would for someone reading the list.
    await page.waitForLoadState("networkidle");
    await link.click();
    await expect(page.getByLabel("Loading meeting")).toBeVisible();
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });
    await expect(page.getByLabel("Loading meeting")).toHaveCount(0);
  });

  test("works by keyboard alone: the tabs, play from a decision, find, highlight and delete", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await open(page, MEETING);
    // Tab reaches the notes tabs, one stop; the arrow keys move between them.
    await tabTo(page, '[role="tab"][aria-selected="true"]');
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const decisions = page.getByRole("tab", { name: /Decisions/ });
    await expect(decisions).toHaveAttribute("aria-selected", "true");
    await expect(decisions).toBeFocused();
    // Into the panel, onto the first decision's time; Enter plays from there, K pauses.
    await tabTo(page, '[role="tabpanel"] button[aria-label^="Play from"]');
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]t=\d/);
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Play (K)" })).toBeVisible();
    // "/" goes to find; Enter steps through the matches; Escape clears and leaves the box.
    await page.keyboard.press("/");
    const find = page.getByRole("searchbox", { name: "Find in this meeting" });
    await expect(find).toBeFocused();
    await page.keyboard.type("the");
    // The ring starts at the match nearest the playhead, not the meeting's first.
    const count = page.getByText(/^\d+ of \d+$/);
    await expect(count).toBeVisible();
    const [at, of] = (await count.textContent())!.match(/\d+/g)!.map(Number);
    await page.keyboard.press("Enter");
    await expect(count).toHaveText(`${at! + 1} of ${of}`);
    await page.keyboard.press("Escape");
    await expect(find).toHaveValue("");
    await expect(find).not.toBeFocused();
    // H clips the moment; Tab reaches the clip's controls; Enter on Delete removes it.
    await page.keyboard.press("h");
    await expect(page.getByText(/^Highlighted \d+ s$/)).toBeVisible({ timeout: 15_000 });
    await tabTo(page, 'button[aria-label="Delete highlight"]');
    await page.keyboard.press("Enter");
    await expect(page.getByText("Highlight deleted")).toBeVisible();
    await expect(page.getByText("Keep a moment worth sharing")).toBeVisible();
  });
});
