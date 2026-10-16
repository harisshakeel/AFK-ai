import type { FullConfig } from "@playwright/test";

/**
 * Loads each main page once before any project runs. Against `pnpm dev`, the first
 * request to a page compiles it; without this, the desktop project (which starts first,
 * with every worker at once) meets a cold compiler and times out on journeys that pass
 * once the server is warm. Against a deployed BASE_URL this is a cheap set of reads.
 */
const PAGES = [
  "/",
  "/samples",
  "/meetings/bmr007",
  "/meetings/bro015",
  "/search?q=warmup",
  "/share/" + "0".repeat(64),
  "/m/warmupcode00",
  "/dashboard",
  "/dashboard/record",
  "/tasks",
  "/memory",
  "/connectors",
  "/send",
  "/welcome?preview=1",
  "/sign-in",
  "/privacy",
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const path of PAGES) {
    // One page at a time: the dev server compiles them in turn either way.
    await fetch(new URL(path, baseURL), { redirect: "manual" }).catch(() => undefined);
  }
}
