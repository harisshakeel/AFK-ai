import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// F9 for a visitor: the live form (guest mode), a labelled demo one button away, and
// nothing sent by the demo.
test("a visitor can play the bot's steps as a labelled demo, and bad links are refused", async ({
  page,
}) => {
  await page.goto("/send");
  // Live when the bot is configured, else the notice; either way the demo button is there.
  await expect(
    page.getByText("No account needed").or(page.getByText(/isn't configured on this deployment/)),
  ).toBeVisible();
  // The form and its help meet the accessibility bar (NFR Accessibility).
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  const link = page.getByLabel("Meeting link");
  await link.fill("https://zoom.us.evil.example/j/123");
  await link.blur();
  await expect(
    page.getByText("AFK can join Zoom, Google Meet and Microsoft Teams links."),
  ).toBeVisible();

  await link.fill("https://meet.google.com/abc-defg-hij");
  await expect(page.getByText("Google Meet meeting")).toBeVisible();
  // The call's language: English and Urdu unless this browser chose otherwise.
  const urdu = page.getByRole("radio", { name: "English and Urdu" });
  await expect(urdu).toBeChecked();
  // The radios are visually hidden behind their labels: switch by clicking the label.
  await page.getByText("English", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "English", exact: true })).toBeChecked();
  await expect(page.getByText(/boosted so the wake word is heard/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "English", exact: true })).toBeChecked();
  await page.getByText("English and Urdu", { exact: true }).click();
  await expect(urdu).toBeChecked();
  // The reload emptied the form; the link again for the demo.
  await link.fill("https://meet.google.com/abc-defg-hij");
  await expect(page.getByText("Google Meet meeting")).toBeVisible();
  await page.getByRole("button", { name: "Show me what happens" }).click();
  await expect(page.getByText("Demo, nothing was sent")).toBeVisible();
  await expect(page.getByRole("link", { name: /hour-long, eight-person meeting/ })).toBeVisible({
    timeout: 10_000,
  });
});

test("the bot route refuses a request with no identity at all", async ({ request }) => {
  const response = await request.post("/api/bot", {
    data: { meetingUrl: "https://meet.google.com/abc-defg-hij" },
  });
  expect(response.status()).toBe(401);
});

test("the webhook refuses an unsigned or forged call", async ({ request }) => {
  const response = await request.post("/api/webhooks/attendee", {
    data: {
      bot_id: "bot_abcdefghijklmnop",
      trigger: "bot.state_change",
      data: { new_state: "ended", event_type: "post_processing_completed" },
    },
    headers: { "x-webhook-signature": "forged" },
  });
  // Without the secret the route answers 503 before checking anything, which proves
  // nothing about signatures: say so instead of passing.
  test.skip(
    response.status() === 503,
    "ATTENDEE_WEBHOOK_SECRET is not configured on this server; the unit test covers the signature",
  );
  expect(response.status()).toBe(401);
});

test("sign-in is offered only when it works", async ({ page }) => {
  // The sign-in page states whether Google is switched on for this deployment.
  await page.goto("/sign-in");
  const google = page.getByRole("button", { name: "Continue with Google" });
  const off = page.getByText(/isn't set up on this deployment/);
  await expect(google.or(off)).toBeVisible();
  const enabled = await google.isVisible();

  await page.goto("/");
  const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in" });
  if (enabled) {
    await expect(signIn).toBeVisible();
    await signIn.click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(google).toBeVisible();
  } else {
    // Off: nothing leads to Supabase's raw "provider is not enabled" error.
    await expect(signIn).toHaveCount(0);
    await page.goto("/send");
    await expect(page.getByRole("link", { name: /Continue with Google to keep it/ })).toHaveCount(
      0,
    );
  }
});
