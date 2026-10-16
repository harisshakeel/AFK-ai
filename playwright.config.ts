import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the installed Google Chrome (no browser download) against a
// dev server, or against BASE_URL when set (preview and production checks).
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Warms every main page once so no journey meets a cold dev-server compile.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "pnpm dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
