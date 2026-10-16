import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  addOwnedMeeting,
  addProposedCommand,
  ageCommands,
  failMeeting,
  localEnv,
  markSummarized,
  signInAsNewUser,
  type TestUser,
} from "./signed-in";

/**
 * The signed-in app, as a brand-new user: the welcome questions, the dashboard shell,
 * the memory page's save, and the tasks page. Needs the local keys (.env.local); skipped
 * without them. The throwaway user is deleted at the end.
 */
test.describe("signed in", () => {
  test.skip(!localEnv(), "needs .env.local for a throwaway user");
  // One long journey; against production the cold routes alone can take a minute.
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let user: TestUser | null = null;
  test.afterEach(async () => {
    await user?.dispose();
    user = null;
  });

  test("a new user is welcomed, lands on an empty dashboard, and keeps a profile", async ({
    page,
    context,
    baseURL,
  }) => {
    // The blocks rise and fade in; the contrast scans must see them still, not mid-fade.
    await page.emulateMedia({ reducedMotion: "reduce" });
    user = await signInAsNewUser(context, baseURL!);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    // No profile yet: the welcome comes first, with the Google-style name offered.
    await page.goto("/welcome");
    await expect(
      page.getByRole("heading", { level: 1, name: "What should AFK call you?" }),
    ).toBeVisible();
    await expect(page.getByLabel("What should AFK call you?")).toHaveValue("E2E Tester");
    const next = page.getByRole("button", { name: "Next", exact: true });
    await page.getByLabel("What should AFK call you?").fill("Tess");
    await next.click();
    await page.getByLabel("What do you do, and where?").fill("Tester at AFK");
    await next.click();
    await page.getByRole("button", { name: "Client calls" }).click();
    await next.click();
    await page.getByRole("button", { name: "Short bullets" }).click();
    await next.click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Good to meet you, Tess." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save and continue" }).click();

    // The dashboard: the app shell, the empty state, no invented numbers.
    // The dev server compiles the route and the dashboard on first use.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Quest log" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText("No quests yet")).toBeVisible();
    // The AFK record is one honest line on the dashboard (Lurker, no streak) and a page
    // of its own behind it, where every badge starts locked with its count.
    await expect(page.getByText("No streak yet")).toBeVisible();
    await page.getByRole("link", { name: "Player card" }).click();
    await expect(page).toHaveURL(/\/dashboard\/record$/, { timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /you're a Lurker/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(
      page.getByRole("list", { name: "Achievements" }).getByRole("listitem"),
    ).toHaveCount(8);
    await expect(page.getByText("First seat, locked")).toBeAttached();
    // With a call on the record the tiles draw from it: the first badge unlocks, the
    // twelve-week bars and the ring have something to say.
    await addOwnedMeeting(user.id);
    await page.goto("/dashboard/record");
    await expect(page.getByText("First seat, unlocked")).toBeAttached();
    await expect(
      page.getByRole("img", { name: /1 quests in the last twelve weeks/ }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /No side quests yet/ })).toBeVisible();
    // Back on the dashboard the call is listed, and the browser logs nothing.
    await page.goto("/dashboard");
    await expect(page.getByRole("main").getByRole("list").first()).toBeVisible();
    const nav = page.getByRole("navigation", { name: "App" }).first();
    await expect(nav.getByRole("link", { name: "Quests" })).toHaveAttribute("aria-current", "page");
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-dashboard.png`,
      fullPage: true,
    });
    // The sidebar collapses to a rail of icons and remembers it; a phone has no sidebar.
    if (test.info().project.name === "desktop") {
      await page.getByRole("button", { name: "Collapse the sidebar" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-sidebar", "rail");
      await page.screenshot({ path: "test-results/screenshots/desktop-dashboard-rail.png" });
      await page.getByRole("button", { name: "Expand the sidebar" }).click();
      await expect(page.locator("html")).not.toHaveAttribute("data-sidebar", "rail");
    }
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);

    // The welcome never shows again once the profile exists.
    await page.goto("/welcome");
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    // Memory: the profile opens as fields that carry the answers; the Markdown view has
    // the whole file, and an edit there saves and survives a reload.
    await page.goto("/memory");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Tess");
    await expect(page.getByLabel("Role and company")).toHaveValue("Tester at AFK");
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    const editor = page.getByLabel("Profile as Markdown");
    await expect(editor).toHaveValue(/Name: Tess/);
    await expect(editor).toHaveValue(/Tester at AFK/);
    await expect(editor).toHaveValue(/Client calls/);
    // On production the HTML arrives before React hydrates; text typed before that is
    // reset by hydration, so fill until the Save button acknowledges the change.
    const original = await editor.inputValue();
    const saveButton = page.getByRole("button", { name: "Save", exact: true });
    await expect(async () => {
      await editor.fill(`${original}\n- Favourite colour: amber\n`);
      await expect(saveButton).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-memory-signed-in.png`,
      fullPage: true,
    });
    await saveButton.click();
    // The button reads "Saved" once the write is confirmed (the toast says it too).
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.reload();
    // The new line is a field now; a value typed into "Name in calls" lands on its line.
    await expect(page.getByLabel("Favourite colour")).toHaveValue("amber");
    const nameInCalls = page.getByLabel("Name in calls", { exact: true });
    await expect(async () => {
      await nameInCalls.fill("Tess Tester");
      await expect(saveButton).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await saveButton.click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await page.goto("/memory?tab=profile.md&field=Name%20in%20calls");
    await expect(page.getByLabel("Name in calls", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await expect(page.getByLabel("Profile as Markdown")).toHaveValue(
      /- Name in calls: Tess Tester\n[\s\S]*Favourite colour: amber/,
    );

    // Tasks: nothing yet, and the page says what would land here.
    await page.goto("/tasks");
    await expect(
      page.getByRole("heading", { level: 1, name: "What AFK heard, and did" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing yet")).toBeVisible();

    // Connectors: the three apps, none connected, each with its way in (or the note that
    // the deployment has no OAuth client yet). Nothing here can act without approval.
    await page.goto("/connectors");
    await expect(
      page.getByRole("heading", { level: 1, name: "What AFK may act through" }),
    ).toBeVisible();
    for (const name of ["Gmail", "Google Calendar", "Slack"]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
    await expect(page.getByText("Not connected")).toHaveCount(3);
    const waysIn = page.getByRole("link", { name: /^Connect (Google|Slack)$/ });
    const notSetUp = page.getByText("Not set up on this deployment yet");
    expect((await waysIn.count()) + (await notSetUp.count())).toBe(3);
    // Which apps have an OAuth client on this deployment: the point of this run.
    // eslint-disable-next-line no-console
    console.log(
      `connectors with a way in: ${(await waysIn.allTextContents()).join(", ") || "none"}`,
    );
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-connectors.png`,
      fullPage: true,
    });
    const connectorsScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(connectorsScan.violations).toEqual([]);

    // The landing page is still reachable while signed in, and leads to the dashboard.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Away from keyboard?");
    // The hero and the closing line both offer it; every one leads to the dashboard.
    const yours = page.getByRole("main").getByRole("link", { name: "Your meetings" });
    await expect(yours).not.toHaveCount(0);
    for (const link of await yours.all()) await expect(link).toHaveAttribute("href", "/dashboard");
    expect(errors).toEqual([]);
  });

  test("a card awaiting approval shows on the dashboard and the Tasks page with who AFK heard, and the skills and people live on the Memory page", async ({
    page,
    context,
    baseURL,
  }) => {
    // The cards and the record rise and fade in; the scans must see them still.
    await page.emulateMedia({ reducedMotion: "reduce" });
    user = await signInAsNewUser(context, baseURL!);
    const meetingId = await addOwnedMeeting(user.id);
    await addProposedCommand(meetingId, {
      kind: "email",
      sentence: "AFK, draft an email to Sam about the launch plan.",
      args: {
        toNames: ["Sam"],
        subject: "Launch plan",
        body: "Hi Sam,\n\nWe settled the launch date today.\n\nBest,\n[your name]",
      },
    });

    await markSummarized(meetingId, "The launch date was settled and the deck has an owner.");

    // The wrap-up pops up first: the headline, the numbers, the card, "How was the
    // meeting?". Later keeps it for the next visit; Done records the verdict and ends it.
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Quest log" })).toBeVisible({
      timeout: 45_000,
    });
    const wrapUp = page.getByRole("dialog", { name: "Launch planning (test)" });
    await expect(wrapUp).toBeVisible({ timeout: 20_000 });
    await expect(wrapUp.getByText("The launch date was settled")).toBeVisible();
    await expect(wrapUp.getByText("1 card waiting for you")).toBeVisible();
    await expect(wrapUp.getByLabel("Subject")).toHaveValue("Launch plan");
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-wrap-up.png`,
    });
    await wrapUp.getByRole("button", { name: "Later" }).click();
    await expect(wrapUp).toBeHidden();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Launch planning (test)" })).toBeHidden();
    await context.clearCookies({ name: "none" }); // session storage stays; a new tab would not
    const fresh = await context.newPage();
    await fresh.goto("/dashboard");
    const again = fresh.getByRole("dialog", { name: "Launch planning (test)" });
    await expect(again).toBeVisible({ timeout: 20_000 });
    await again.getByRole("button", { name: "Good" }).click();
    await again.getByLabel("A word on why").fill("Caught the deck owner.");
    await again.getByRole("button", { name: "Done" }).click();
    await expect(again).toBeHidden();
    await fresh.reload();
    await expect(fresh.getByRole("dialog", { name: "Launch planning (test)" })).toHaveCount(0);
    await fresh.close();

    // A day later with the card still waiting: the nudge, once a day, until it is dealt with.
    await ageCommands(meetingId, 2);
    await page.reload();
    const nudge = page.getByRole("dialog", { name: "Launch planning (test)" });
    await expect(nudge).toBeVisible({ timeout: 20_000 });
    await expect(nudge.getByText("Still waiting for you")).toBeVisible();
    await expect(nudge.getByText("These have waited a day.")).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-nudge.png`,
    });
    await nudge.getByRole("button", { name: "Later" }).click();
    await expect(nudge).toBeHidden();
    const other = await context.newPage();
    await other.goto("/dashboard");
    await expect(other.getByRole("heading", { level: 1, name: "Quest log" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(other.getByRole("dialog", { name: "Launch planning (test)" })).toHaveCount(0);
    await other.close();

    // The first-run checklist, for a new account: four things, each a link to where it is done.
    await page.reload();
    const checklist = page.getByRole("region", { name: "Getting set up" });
    await expect(checklist).toBeVisible();
    await expect(
      checklist.getByRole("link", { name: "Connect Google, for Gmail and Calendar" }),
    ).toBeVisible();
    await expect(
      checklist.getByRole("link", { name: "Tell AFK the name you show in calls" }),
    ).toBeVisible();
    // One call was sent (the test meeting carries no bot, so that one stays open too).
    await expect(checklist.getByText("0 of 4")).toBeVisible();
    const awaiting = page.getByRole("region", { name: "Awaiting your approval" });
    await expect(awaiting).toBeVisible();
    await expect(awaiting.getByText("Launch planning (test)")).toBeVisible();
    await expect(awaiting.getByLabel("Subject")).toHaveValue("Launch plan");
    const heard = awaiting.getByRole("list", { name: "Who AFK heard" });
    await expect(heard).toContainText("Sam");
    await expect(heard).toContainText("no address yet");
    await expect(awaiting.getByRole("link", { name: "Connect Gmail to approve" })).toBeVisible();
    await expect(awaiting.getByRole("button", { name: "Rewrite" })).toBeVisible();
    // The badge sits on the sidebar on a wide screen and on the strip on a phone.
    await expect(
      page.getByLabel("1 awaiting your approval").filter({ visible: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/screenshots/${test.info().project.name}-dashboard-approvals.png`,
      fullPage: true,
    });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);

    // The Tasks page: the same card first, under "Waiting for you".
    await page.goto("/tasks");
    const waiting = page.getByRole("region", { name: "Waiting for you" });
    await expect(waiting).toBeVisible();
    await expect(waiting.getByLabel("Subject")).toHaveValue("Launch plan");

    // Memory: the three skills are files with their tabs, and the people AFK knows have a
    // place, empty until a card is approved or Google is imported.
    await page.goto("/memory");
    await page.getByRole("tab", { name: "Email skill" }).click();
    await expect(page.getByLabel("Sign-off", { exact: true })).toHaveValue("Best, {my name}");
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await expect(page.getByLabel("Email skill as Markdown")).toHaveValue(/How to write it/);
    await expect(page.getByRole("heading", { level: 2, name: "People AFK knows" })).toBeVisible();
    await expect(page.getByText("Nobody yet.")).toBeVisible();
  });

  test("a meeting without AI notes still works, typed commands land on Tasks, and the write limit holds across them", async ({
    page,
    context,
    baseURL,
  }) => {
    user = await signInAsNewUser(context, baseURL!);
    const meetingId = await addOwnedMeeting(user.id);
    await page.goto(`/meetings/${meetingId}`);
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 45_000 });

    // No AI output yet, and no recording behind the path: the page says both, and the
    // transcript works regardless (F4, NFR Degradation).
    await expect(
      page.getByRole("status").filter({ hasText: "No summary has been generated" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /This meeting has no recording|The audio didn't load/ }),
    ).toBeVisible();
    const viewport = page.viewportSize();
    const phone = viewport !== null && viewport.width < 1024;
    if (phone) await page.getByRole("button", { name: "Transcript" }).click();
    await expect(page.locator("li[data-index]")).toHaveCount(3);
    const find = page.getByRole("searchbox", { name: "Find in this meeting" });
    await find.fill("deck");
    await expect(page.getByText("1 of 1")).toBeVisible();
    await find.fill("");
    if (phone) await page.getByRole("button", { name: "Notes" }).click();

    // Share the notes: one email card to the people on the call, from the stored notes.
    await page.getByRole("button", { name: /Share/ }).click();
    await expect(page).toHaveURL(/tab=tasks/, { timeout: 20_000 });
    await expect(page.getByLabel("Subject").first()).toHaveValue(
      "Notes from Launch planning (test)",
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByRole("list", { name: "Who AFK heard" }).first()).toContainText("Sam");

    // A typed command applies at once and shows on the Tasks tab (C5).
    await page.getByRole("tab", { name: /Tasks/ }).click();
    await page
      .getByLabel("Didn't catch a command? Type it")
      .fill("/note the pricing page needs a second look");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(/the pricing page needs a second look/).first()).toBeVisible({
      timeout: 15_000,
    });

    // The limit (NFR Rate limits): sixty writes a minute, counted together across typed
    // commands, memory saves, approvals and dismissals. Typed commands also stop at
    // twenty a meeting. Writes so far: two (the shared-notes card, the note). The requests below are sent one at a time,
    // as the counter is per minute; a slow server could let the window slide, so the
    // refusals are only asserted when the whole run stayed well inside a minute.
    const started = Date.now();
    const typed = (text: string) =>
      page.request.post(`/api/meetings/${meetingId}/commands`, { data: { text } });
    const save = (n: number) =>
      page.request.put("/api/memory/profile.md", {
        data: { content: `# Profile\n\n- Name: Tess\n- Saved: ${n}\n` },
      });
    const change = (commandId: string, action: "approve" | "dismiss") =>
      page.request.post(`/api/commands/${commandId}`, { data: { action } });
    for (let i = 0; i < 17; i++) {
      expect((await typed(`/note line ${i}`)).status(), `typed command ${i}`).toBe(201);
    }
    const slack = await typed("/slack the deck is on its way");
    expect(slack.status()).toBe(201);
    const { commandId } = (await slack.json()) as { commandId: string };
    const overCap = await typed("/note one past the meeting's cap"); // write 21, refused by the cap
    expect(overCap.status()).toBe(429);
    expect(((await overCap.json()) as { error: string }).error).toMatch(/20 typed commands/);
    for (let i = 0; i < 38; i++) {
      expect((await save(i)).status(), `memory save ${i}`).toBe(200); // writes 22 to 59
    }
    expect((await change(commandId, "dismiss")).status()).toBe(200); // write 60
    const refused = [
      await typed("/note sixty-one"),
      await save(99),
      await change(commandId, "approve"),
      await change(commandId, "dismiss"),
    ];
    const elapsedMs = Date.now() - started;
    // The time is the point: a run that bailed out below must be visible in the output.
    // eslint-disable-next-line no-console
    console.log(`sixty writes in ${(elapsedMs / 1000).toFixed(1)} s`);
    if (elapsedMs > 50_000) {
      test.info().annotations.push({
        type: "not proven",
        description: `the sixty writes took ${Math.round(elapsedMs / 1000)} s, so the minute's window may have slid`,
      });
      return;
    }
    for (const response of refused) {
      expect(response.status()).toBe(429);
      expect(((await response.json()) as { error: string }).error).toMatch(/Wait a minute/);
    }
  });

  test("a meeting still being recorded shows its progress and keeps up by itself", async ({
    page,
    context,
    baseURL,
  }) => {
    user = await signInAsNewUser(context, baseURL!);
    const meetingId = await addOwnedMeeting(user.id, { stage: "recording" });
    await page.goto(`/meetings/${meetingId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Launch planning (test)" }),
    ).toBeVisible();
    const progress = page.getByRole("list", { name: "Progress" });
    // Exact: "Processing the recording" is the next step.
    await expect(progress.getByRole("listitem").filter({ hasText: /^Recording$/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.getByText(/checks on progress every ten seconds/)).toBeVisible();
    // The bot never reports back. The keep-alive's sweep closes it (done here by hand, as
    // the cron would), and the page shows the outcome without a reload.
    await failMeeting(
      meetingId,
      "AFK heard nothing more from the bot for six hours, so this meeting was closed.",
    );
    const alert = page.getByRole("alert").filter({ hasText: "AFK couldn't record this meeting" });
    await expect(alert).toBeVisible({ timeout: 25_000 });
    await expect(alert).toContainText("six hours");
  });
});
