import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Memory and tasks for a signed-out visitor (requirements M6, M10, C7): the demo memory
 * page, the welcome preview, and the pages and routes that need a sign-in.
 */
test("a visitor sees a labelled demo of the memory files and can't save them", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/memory");
  await expect(
    page.getByRole("heading", { level: 1, name: "What AFK knows about you" }),
  ).toBeVisible();
  await expect(page.getByText("Demo: sign in to keep your own")).toBeVisible();
  // The profile opens as fields; the Markdown view has the whole file. Both read-only here.
  const role = page.getByLabel("Role and company");
  await expect(role).toHaveAttribute("aria-readonly", "true");
  await expect(role).toHaveValue(/this is a demo profile/);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const editor = page.getByLabel("Profile as Markdown");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await expect(editor).toHaveValue(/this is a demo profile/);
  await page.getByRole("tab", { name: "Meetings" }).click();
  await expect(page.getByText("written by AFK", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Forget everything" })).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the welcome preview walks through the questions without saving", async ({ page }) => {
  await page.goto("/welcome?preview=1");
  await expect(
    page.getByRole("heading", { level: 1, name: "What should AFK call you?" }),
  ).toBeVisible();
  await expect(page.getByText(/Preview\. Sign in and this is what you see first/)).toBeVisible();
  // exact: the dev overlay's "Open Next.js Dev Tools" button also contains "Next".
  const next = page.getByRole("button", { name: "Next", exact: true });
  const skip = page.getByRole("button", { name: "Skip", exact: true });
  await page.getByLabel("What should AFK call you?").fill("Sam");
  await next.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "What do you do, and where?" }),
  ).toBeVisible();
  await skip.click();
  await page.getByRole("button", { name: "Team syncs" }).click();
  await next.click();
  await page.getByRole("button", { name: "Decisions first" }).click();
  await next.click();
  await skip.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Good to meet you, Sam." }),
  ).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  await page.getByRole("button", { name: "Sign in to save" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
});

test("the welcome needs a sign-in, tasks opens for guests, and the memory routes refuse strangers", async ({
  request,
}) => {
  const welcome = await request.get("/welcome", { maxRedirects: 0 });
  expect(welcome.status()).toBe(307);
  expect(welcome.headers()["location"]).toMatch(/\/sign-in\?next=/);
  const tasks = await request.get("/tasks", { maxRedirects: 0 });
  expect(tasks.status()).toBe(200);
  const save = await request.put("/api/memory/profile.md", { data: { content: "# Mine" } });
  expect(save.status()).toBe(401);
  const erase = await request.delete("/api/memory");
  expect(erase.status()).toBe(401);
  const onboarding = await request.post("/api/memory/onboarding", { data: { skipped: true } });
  expect(onboarding.status()).toBe(401);
  const unknown = await request.put("/api/memory/secrets.md", { data: { content: "x" } });
  expect(unknown.status()).toBe(404);
});
