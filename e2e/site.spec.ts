import { expect, test } from "@playwright/test";

/**
 * The site as a whole: the per-request Content-Security-Policy, the metadata routes
 * (icons, social image, manifest, robots, sitemap) and the list pages' paging link.
 */
test("every HTML response carries a nonce-based script policy, and the pages still run", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("/samples");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // The nonce differs per request.
  const again = await page.goto("/samples");
  expect(again?.headers()["content-security-policy"]).not.toBe(csp);
  // A page URL that ends like an image is still a page, and still carries the policy.
  const lookalike = await page.request.get("/share/not-a-token.png");
  expect(lookalike.headers()["content-security-policy"]).toMatch(/script-src/);
  // Scripts ran under the policy: the header's search form submits through Next.
  await page.getByRole("searchbox", { name: "Search all meetings" }).fill("digits");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=digits/);
  expect(errors).toEqual([]);
});

test("the icons, social image, manifest, robots and sitemap all resolve", async ({ request }) => {
  for (const [path, type] of [
    ["/icon.svg", "image/svg+xml"],
    ["/apple-icon", "image/png"],
    ["/opengraph-image", "image/png"],
    ["/manifest.webmanifest", "application/manifest+json"],
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "application/xml"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain(type);
  }
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /dashboard");
  expect(robots).toContain("Sitemap:");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/meetings/bmr007");
  expect(sitemap).toContain("/samples");
});

test("the landing page describes itself for search engines and link previews", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /opengraph-image/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /AFK joins/);
  // The site's root, with or without the trailing slash Next leaves off.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /^https?:\/\/[^/]+\/?$/,
  );
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon\.svg/);
});

test("the welcome flow answers a signed-out request with a real redirect", async ({ request }) => {
  const response = await request.get("/welcome", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toMatch(/\/sign-in\?next=%2Fwelcome$/);
  // Guest mode: the dashboard itself is open to everyone.
  const dashboard = await request.get("/dashboard", { maxRedirects: 0 });
  expect(dashboard.status()).toBe(200);
});

test("a bad paging cursor falls back to the first page", async ({ page }) => {
  await page.goto("/samples?after=not-a-cursor");
  await expect(page.getByRole("heading", { level: 1, name: "Sample meetings" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Meeting Recorder project meeting.*Nov 9, 2000/ }),
  ).toBeVisible();
  // Five samples fit on one page, so there is no "older" link to a page that would be empty.
  await expect(page.getByRole("link", { name: "Older quests" })).toHaveCount(0);
});

test("the health route answers with counts only, and the kick route needs the cron secret", async ({
  request,
}) => {
  const health = await request.get("/api/health");
  expect([200, 503]).toContain(health.status());
  expect(health.headers()["cache-control"]).toContain("no-store");
  const body = await health.json();
  expect(typeof body.ok).toBe("boolean");
  expect(body.queue === null || typeof body.queue.runnable === "number").toBe(true);
  expect(typeof body.configured.ai).toBe("boolean");
  // Nothing in it could be an address, a key or a token.
  expect(JSON.stringify(body)).not.toMatch(/@|sk-|eyJ/);
  for (const method of ["get", "post"] as const) {
    const kick = await request[method]("/api/jobs/kick");
    expect(kick.status(), method).toBe(401);
  }
  const wrong = await request.post("/api/jobs/kick", {
    headers: { authorization: "Bearer not-the-secret-at-all" },
  });
  expect(wrong.status()).toBe(401);
  // Non-ASCII bytes, whatever the character count: still a 401, never a thrown compare.
  const bytes = await request.post("/api/jobs/kick", {
    headers: { authorization: `Bearer ${"é".repeat(40)}` },
  });
  expect(bytes.status()).toBe(401);
});
