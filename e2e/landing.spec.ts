import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** The landing page: every link goes somewhere, and the dashboard needs a sign-in. */
test("the landing page loads clean, scans clean, and its links work", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  // With reduced motion the page is still, so the contrast scan never catches text
  // mid-fade, and the hero offers a play button instead of scrubbing with the scroll.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Away from keyboard?");
  const sample = page.getByRole("link", { name: "Open the hour-long sample" });
  await expect(sample).toHaveCount(2);
  for (const link of await sample.all())
    await expect(link).toHaveAttribute("href", "/meetings/bmr007");
  // The third thing to do: leave your Gmail to be added as a test user. The address goes
  // to access_requests for real (the same one every run: a repeat answers like a first).
  await page.getByLabel("The Gmail you would sign in with").fill("afk-journey@example.com");
  await page.getByRole("button", { name: "Get added to test users" }).click();
  await expect(page.getByRole("status")).toContainText("You're on the list.");
  // The route through the product: seven stops, the sixth naming the tools.
  await expect(page.locator('ol[aria-label="How AFK works"] > li')).toHaveCount(7);
  await expect(page.getByRole("list", { name: "Tools" }).getByRole("listitem")).toHaveCount(3);
  // The animation: both encodes, a captions track, and the way to play it without motion.
  const video = page.locator("video");
  await expect(video.locator('source[type="video/mp4"]')).toHaveAttribute(
    "src",
    "/landing/hero.mp4",
  );
  await expect(video.locator('track[kind="captions"]')).toHaveAttribute("src", "/landing/hero.vtt");
  await expect(page.getByRole("button", { name: "Play the animation" })).toBeVisible();
  await expect(page.getByText("The short version")).toBeVisible();
  // The claim types itself out once it is on screen, below the full-screen animation;
  // under reduced motion it is simply there, whole.
  await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "The meeting still gets written up.",
  );
  // The route's heading rises out of a clipped line, word by word; every word must end
  // where it started, and the scan must see the text at its final place, not mid-rise.
  await page.getByText("The short version").scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...(document.querySelector("h2")?.querySelectorAll("span span") ?? [])].every((word) => {
            const transform = getComputedStyle(word).transform;
            return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
          }),
        ),
      { timeout: 20_000, message: "the heading's words never finished rising" },
    )
    .toBe(true);
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
  // On failure the first messages are the useful part, so they are the assertion's message.
  expect(consoleErrors, consoleErrors.slice(0, 3).join("\n---\n").slice(0, 2000)).toEqual([]);

  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Samples" })
    .click();
  await expect(page).toHaveURL(/\/samples$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sample meetings" })).toBeVisible();
});

test("scrolling plays the hero animation, and scrolling back rewinds it", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("video");
  // The playhead follows the scroll only once the browser knows the video's length.
  await expect
    .poll(() => video.evaluate((element) => (element as HTMLVideoElement).duration), {
      timeout: 30_000,
      message: "the video's metadata never loaded",
    })
    .toBeGreaterThan(11);
  const time = () => video.evaluate((element) => (element as HTMLVideoElement).currentTime);
  const playing = () => video.evaluate((element) => !(element as HTMLVideoElement).paused);
  // At the top, before any scroll, the opening breathes on a loop within its first second.
  await expect
    .poll(playing, { timeout: 10_000, message: "the idle loop never started" })
    .toBe(true);
  expect(await time()).toBeLessThan(1);

  // The run at the top of the page is five to seven screens tall; the stage sticks at the
  // top while the page moves through it, and the playhead follows that progress.
  const run = await page.evaluate(() => {
    const element = document.querySelector("[data-scrub]") as HTMLElement;
    const stage = element.firstElementChild as HTMLElement;
    const top = element.getBoundingClientRect().top + window.scrollY;
    return { start: top, travel: element.offsetHeight - stage.offsetHeight };
  });
  await page.evaluate((y) => window.scrollTo(0, y), run.start + run.travel * 0.5);
  await expect.poll(time, { timeout: 10_000 }).toBeGreaterThan(4);
  const halfway = await time();
  expect(halfway).toBeLessThan(7);
  // Scrolled, the loop has let go: the scroll alone moves the playhead.
  expect(await playing()).toBe(false);
  // The stage is still on screen halfway down, so the visitor is watching, not past it.
  await expect(video).toBeInViewport();

  await page.evaluate((y) => window.scrollTo(0, y), run.start + run.travel);
  await expect.poll(time, { timeout: 10_000 }).toBeGreaterThan(halfway + 3);

  // Past the run, the claim types by the scroll too: nothing while the heading is still
  // below the bottom edge, all of it once the heading has reached the top.
  const typed = page.locator("h1 [aria-hidden]");
  await expect(typed).not.toContainText("meeting");
  await page.evaluate(() => document.querySelector("h1")?.scrollIntoView({ block: "start" }));
  await expect(typed).toContainText("written up.", { timeout: 10_000 });

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(time, { timeout: 10_000 }).toBeLessThan(1);
  await expect.poll(playing, { timeout: 10_000, message: "the loop did not resume" }).toBe(true);
});

test("the landing keeps the animation's light palette in dark mode", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Dark mode is the visitor's stored choice, restored before the first paint.
  await page.addInitScript(() => localStorage.setItem("afk-theme", "dark"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Away from keyboard?");
  // The wrapper redeclares the light tokens, so the canvas inside it is the cream.
  const canvas = await page.evaluate(() => {
    const wrapper = document.querySelector("main")!.parentElement!;
    return {
      inside: getComputedStyle(wrapper).getPropertyValue("--color-canvas").trim(),
      outside: getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim(),
    };
  });
  // The browser hands the token back canonicalised (lab(), oklch(), ...); its first
  // number is the lightness, near 97% for the cream and near 16% for the dark canvas.
  const lightness = (value: string) => Number(/\(\s*([\d.]+)%/.exec(value)?.[1] ?? NaN);
  expect(lightness(canvas.inside)).toBeGreaterThan(90);
  expect(lightness(canvas.outside)).toBeLessThan(40);

  // The app itself is dark, and the sun/moon button turns it light again and remembers.
  await page.goto("/samples");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  const rootCanvas = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim(),
    );
  expect(lightness(await rootCanvas())).toBeLessThan(40);
  await page.getByRole("button", { name: "Dark mode" }).click();
  await expect(html).not.toHaveAttribute("data-theme", "dark");
  expect(lightness(await rootCanvas())).toBeGreaterThan(90);
  expect(await page.evaluate(() => localStorage.getItem("afk-theme"))).toBe("light");
});

test("the footer's links all resolve", async ({ page, request }) => {
  await page.goto("/");
  // The page streams behind its loading state; wait for the footer before counting.
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer).toBeVisible({ timeout: 30_000 });
  const links = await footer.getByRole("link").all();
  expect(links.length).toBeGreaterThanOrEqual(4);
  for (const link of links) {
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    if (href!.startsWith("/")) {
      const response = await request.get(href!);
      expect(response.status(), href!).toBeLessThan(400);
    }
  }
});

test("the dashboard opens for a visitor, and the connectors are locked until Google", async ({
  page,
  request,
}) => {
  // Guest mode: no sign-in wall. A visitor with no workspace sees the empty quest log.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quest log" })).toBeVisible();
  await expect(page.getByText("No quests yet")).toBeVisible();
  await page.goto("/connectors");
  await expect(page.getByText("Connectors are for Google accounts")).toBeVisible();
  const start = await request.get("/connectors/google/start", { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  expect(start.headers().location).toContain("/sign-in");
});

test("the privacy page reads and scans clean", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What is kept");
  await expect(page.getByRole("heading", { level: 2, name: "Who can see it" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(scan.violations).toEqual([]);
});
