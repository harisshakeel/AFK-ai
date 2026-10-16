import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { localEnv } from "./signed-in";

/**
 * Performance measurements, not pass/fail journeys. Skipped unless MEASURE=1, because
 * they take minutes and their value is the numbers, which land in
 * .metrics/<project>.json (gitignored) and in the test output.
 *
 *   MEASURE=1 pnpm e2e e2e/metrics.spec.ts --workers=1
 *   MEASURE=1 BASE_URL=https://<deployment> pnpm e2e e2e/metrics.spec.ts --workers=1
 *
 * Every number is labelled with its conditions: against the dev server the figures are
 * pessimistic (no minification, on-demand compilation), so the deployed run is the one
 * that counts for the requirements table.
 */
test.skip(!process.env.MEASURE, "set MEASURE=1 to run the measurements");

const RUNS = 5;
const LONG = "/meetings/bmr007";

type LoadSample = {
  ttfbMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  lcpMs: number;
  hydratedMs: number | null;
  htmlBytes: number;
  transferBytes: number;
  domNodes: number;
  transcriptRows: number;
};

type InteractionSample = { label: string; ms: number };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const at = (index: number) => sorted[index] ?? 0;
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
};
/** The nearest-rank percentile: the value at least p of the samples fall at or under. */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
};
const summarise = (values: number[]) => ({
  n: values.length,
  min: Math.round(Math.min(...values)),
  median: Math.round(median(values)),
  p95: Math.round(percentile(values, 0.95)),
  max: Math.round(Math.max(...values)),
});

/**
 * Lighthouse's "slow 4G" phone: 150 ms round trips, 1.6 Mbps down, 750 kbps up, the CPU
 * four times slower. Applied through Chrome's devtools protocol on a fresh context.
 */
const SLOW_PHONE = {
  label: "CPU 4× slower, 150 ms RTT, 1.6 Mbps down, 750 kbps up (Lighthouse slow 4G)",
  network: {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  cpuRate: 4,
};

/** A short, sorted list of the meeting's turn timings for the sync measurement. */
async function turnTimings(meetingId: string): Promise<Array<[number, number]> | null> {
  const env = localEnv();
  if (!env) return null;
  const rows: Array<[number, number]> = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.url}/rest/v1/transcript_turns?meeting_id=eq.${meetingId}&select=idx,start_sec,end_sec&order=idx&offset=${offset}&limit=1000`,
      { headers: { apikey: env.publishableKey } },
    );
    if (!response.ok) return null;
    const page = (await response.json()) as Array<{ start_sec: string; end_sec: string }>;
    rows.push(
      ...page.map((row) => [Number(row.start_sec), Number(row.end_sec)] as [number, number]),
    );
    if (page.length < 1000) break;
  }
  return rows;
}

/** Buffer LCP and the moment the page reports hydration, from navigation start. */
const INIT_SCRIPT = `
  window.__lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  window.__hydratedAt = null;
  const check = () => {
    if (window.__hydratedAt === null && document.querySelector('[data-hydrated="true"]')) {
      window.__hydratedAt = performance.now();
      return true;
    }
    return false;
  };
  const observer = new MutationObserver(() => { if (check()) observer.disconnect(); });
  document.addEventListener("DOMContentLoaded", () => {
    if (!check()) observer.observe(document.documentElement, { attributes: true, subtree: true, childList: true });
  });
`;

async function loadOnce(
  browser: Browser,
  path: string,
  waitFor: "hydrated" | "main",
  problems: string[],
  throttle = false,
): Promise<LoadSample> {
  // A fresh context each time: cold browser cache, warm server.
  const context = await browser.newContext();
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  if (throttle) {
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.emulateNetworkConditions", SLOW_PHONE.network);
    await session.send("Emulation.setCPUThrottlingRate", { rate: SLOW_PHONE.cpuRate });
  }
  let htmlBytes = 0;
  page.on("response", async (response) => {
    if (response.request().resourceType() === "document" && response.url().includes(path)) {
      htmlBytes = (await response.body().catch(() => Buffer.alloc(0))).length;
    }
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    // Link prefetches cut off when the context closes are not failures.
    const aborted = request.failure()?.errorText.includes("ERR_ABORTED") ?? false;
    if (request.resourceType() === "media" || (aborted && request.url().includes("_rsc="))) return;
    problems.push(`failed ${request.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text().slice(0, 160)}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message.slice(0, 160)}`));

  await page.goto(path, { waitUntil: "load" });
  if (waitFor === "hydrated") {
    await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 60_000 });
  } else {
    await expect(page.getByRole("main")).toBeVisible({ timeout: 60_000 });
  }
  // Give LCP a moment to settle after load.
  await page.waitForTimeout(300);
  const sample = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const w = window as unknown as { __lcp: number; __hydratedAt: number | null };
    return {
      ttfbMs: nav.responseStart,
      domContentLoadedMs: nav.domContentLoadedEventEnd,
      loadMs: nav.loadEventEnd,
      lcpMs: w.__lcp,
      hydratedMs: w.__hydratedAt,
      transferBytes:
        nav.encodedBodySize + resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
      domNodes: document.getElementsByTagName("*").length,
      transcriptRows: document.querySelectorAll("li[data-index]").length,
    };
  });
  await context.close();
  return { ...sample, htmlBytes };
}

/**
 * Time from an in-page click to the first DOM change that satisfies `done`. `find` and
 * `done` are JavaScript expressions evaluated in the page: `find` returns the element to
 * click, `done` returns true once the UI shows the result.
 */
async function timeInteraction(
  page: Page,
  find: string,
  done: string,
  label: string,
): Promise<InteractionSample> {
  const ms = await page.evaluate(
    ({ find, done }) =>
      new Promise<number>((resolve, reject) => {
        // Compiled here, synchronously inside the evaluate, which Chrome allows under the
        // production CSP (no 'unsafe-eval'); compiling later, in the observer, is refused.
        const isDone = new Function("return (" + done + ")") as () => boolean;
        const target = (new Function("return (" + find + ")") as () => HTMLElement | null)();
        if (!target) return reject(new Error(`no element for ${find}`));
        if (isDone()) return reject(new Error(`already done before click: ${find}`));
        const start = performance.now();
        const timeout = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`timed out: ${find}`));
        }, 10_000);
        const observer = new MutationObserver(() => {
          if (isDone()) {
            observer.disconnect();
            clearTimeout(timeout);
            // Resolve after paint so the number includes the frame.
            requestAnimationFrame(() => resolve(performance.now() - start));
          }
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        target.click();
      }),
    { find, done },
  );
  return { label, ms };
}

/** A JavaScript expression that finds the first element matching `selector` whose text includes `text`. */
const byText = (selector: string, text: string) =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;

async function openHydrated(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('[data-hydrated="true"]')).toBeAttached({ timeout: 60_000 });
}

test("measure page loads, interactions and search", async ({ browser, page }, info) => {
  test.setTimeout(15 * 60_000);
  const problems: string[] = [];
  const project = info.project.name;
  const baseURL = info.project.use.baseURL ?? "http://localhost:3000";
  const results: Record<string, unknown> = {
    conditions: {
      baseURL,
      project,
      viewport: info.project.use.viewport,
      serverMode: /localhost/.test(baseURL) ? "next dev (development build)" : "deployed",
      runsPerPage: RUNS,
      browser: "installed Google Chrome via Playwright, fresh context per load (cold cache)",
    },
  };

  // 1. Page loads. The first visit compiles on the dev server; discard it.
  const pages: Array<[string, "hydrated" | "main"]> = [
    ["/", "main"],
    [LONG, "hydrated"],
    ["/meetings/bro015", "hydrated"],
    [`${LONG}?t=1838.5`, "hydrated"],
    ["/search?q=overlap", "main"],
  ];
  const loads: Record<string, unknown> = {};
  for (const [path, waitFor] of pages) {
    await loadOnce(browser, path, waitFor, []); // warm-up, discarded
    const samples: LoadSample[] = [];
    for (let i = 0; i < RUNS; i++) samples.push(await loadOnce(browser, path, waitFor, problems));
    loads[path] = {
      ttfbMs: summarise(samples.map((s) => s.ttfbMs)),
      domContentLoadedMs: summarise(samples.map((s) => s.domContentLoadedMs)),
      loadMs: summarise(samples.map((s) => s.loadMs)),
      lcpMs: summarise(samples.map((s) => s.lcpMs)),
      hydratedMs: samples.every((s) => s.hydratedMs !== null)
        ? summarise(samples.map((s) => s.hydratedMs as number))
        : null,
      htmlKB: Math.round((samples[0]?.htmlBytes ?? 0) / 1024),
      transferKB: Math.round(median(samples.map((s) => s.transferBytes)) / 1024),
      domNodes: samples[0]?.domNodes ?? 0,
      transcriptRows: samples[0]?.transcriptRows ?? 0,
    };
  }
  results.loads = loads;

  // Not under test-results/, which Playwright empties at the start of every run.
  const save = () => {
    mkdirSync(".metrics", { recursive: true });
    writeFileSync(`.metrics/${project}.json`, JSON.stringify(results, null, 2));
  };
  save();

  // 1b. The long meeting on a slow phone (NFR Load: main content within 4 s).
  if (project === "phone") {
    await loadOnce(browser, LONG, "hydrated", [], true); // warm-up, discarded
    const samples: LoadSample[] = [];
    for (let i = 0; i < RUNS; i++)
      samples.push(await loadOnce(browser, LONG, "hydrated", problems, true));
    results.loadsThrottled = {
      conditions: SLOW_PHONE.label,
      [LONG]: {
        ttfbMs: summarise(samples.map((s) => s.ttfbMs)),
        domContentLoadedMs: summarise(samples.map((s) => s.domContentLoadedMs)),
        lcpMs: summarise(samples.map((s) => s.lcpMs)),
        hydratedMs: samples.every((s) => s.hydratedMs !== null)
          ? summarise(samples.map((s) => s.hydratedMs as number))
          : null,
        loadMs: summarise(samples.map((s) => s.loadMs)),
      },
    };
    save();
  }

  // 2. Interactions on the long meeting. A failed interaction is recorded, not fatal.
  await openHydrated(page, LONG);
  const isPhone = (page.viewportSize()?.width ?? 1280) < 1024;
  const interactions: InteractionSample[] = [];
  const interactionErrors: string[] = [];
  const measure = async (find: string, done: string, label: string) => {
    try {
      interactions.push(await timeInteraction(page, find, done, label));
    } catch (error) {
      interactionErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Summary template switches: alternate so each click changes the content.
  const templates = ["Project update", "General", "Brief", "Catch me up"];
  const headings: Record<string, string> = {
    "Project update": "Progress",
    General: "Overview",
    Brief: "In three points",
    "Catch me up": "What you missed",
  };
  for (let i = 0; i < RUNS; i++) {
    const name = templates[i % templates.length] ?? "General";
    await measure(
      byText('[aria-label="Summary template"] button', name),
      `[...document.querySelectorAll("h2, h3")].some((h) => h.textContent === ${JSON.stringify(headings[name] ?? "")})`,
      "template switch",
    );
  }

  // Notes tab switches.
  for (const tab of ["Decisions", "Summary", "Action", "Chapters", "Summary"]) {
    await measure(
      byText('[role="tab"]', tab),
      `${byText('[role="tab"]', tab)}?.getAttribute("aria-selected") === "true"`,
      "tab switch",
    );
  }

  // Seeking: click a transcript line far down and wait for it to become the current line.
  if (isPhone) await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator("li[data-index]").first()).toBeVisible();
  for (const index of [400, 900, 120, 1000, 650].slice(0, RUNS)) {
    await page.locator(`li[data-index="${index}"]`).scrollIntoViewIfNeeded();
    await measure(
      `document.querySelector('li[data-index="${index}"] button')`,
      `document.querySelector('li[aria-current="true"]')?.getAttribute("data-index") === "${index}"`,
      "seek by transcript line",
    );
  }
  results.interactionErrors = interactionErrors;
  save();

  // 2b. Sync (NFR Interaction: the marked line at most 250 ms behind the audio). Play for
  // thirty seconds from where the last seek left the player and, every frame, compare the
  // line the source timings say is current with the line the page marks. A change in the
  // expected line is caught up with after `lagMs`; -1 means never within the window.
  const timings = await turnTimings("bmr007");
  if (timings) {
    // The seeks above may have left the player playing; K only when it is paused.
    const pauseButton = page.getByRole("button", { name: "Pause (K)" });
    if (!(await pauseButton.isVisible())) await page.keyboard.press("k");
    await expect(pauseButton).toBeVisible({ timeout: 15_000 });
    const sync = await page.evaluate(
      ({ turns, seconds }) =>
        new Promise<{
          frames: number;
          framesInSync: number;
          changes: number;
          lagMs: number[];
          audioAdvancedSec: number;
        }>((resolve) => {
          const audio = document.querySelector("audio");
          if (!audio) {
            resolve({ frames: 0, framesInSync: 0, changes: 0, lagMs: [], audioAdvancedSec: 0 });
            return;
          }
          // The rule from src/lib/time-rules.ts: the latest-starting turn that contains the
          // moment (looking back over overlaps), else the last turn that started.
          const lastStarted = (sec: number) => {
            let lo = 0;
            let hi = turns.length - 1;
            let found = -1;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              if ((turns[mid]?.[0] ?? Infinity) <= sec) {
                found = mid;
                lo = mid + 1;
              } else hi = mid - 1;
            }
            return found;
          };
          const expectedAt = (sec: number) => {
            const last = lastStarted(sec);
            if (last < 0) return -1;
            for (let i = last; i >= 0 && i > last - 64; i--) {
              const turn = turns[i];
              if (turn && turn[0] <= sec && sec < turn[1]) return i;
            }
            return last;
          };
          const marked = () =>
            Number(
              document.querySelector('li[aria-current="true"]')?.getAttribute("data-index") ?? -1,
            );
          const samples: Array<[number, number, number]> = [];
          const audioStart = audio.currentTime;
          const start = performance.now();
          const tick = (now: number) => {
            samples.push([now, expectedAt(audio.currentTime), marked()]);
            if (now - start < seconds * 1000) {
              requestAnimationFrame(tick);
              return;
            }
            const lagMs: number[] = [];
            let changes = 0;
            let framesInSync = 0;
            for (let i = 1; i < samples.length; i++) {
              const [, expected, shown] = samples[i]!;
              if (expected === shown) framesInSync++;
              if (expected !== samples[i - 1]![1]) {
                changes++;
                let caughtUp = -1;
                for (let j = i; j < samples.length; j++) {
                  if (samples[j]![2] === expected) {
                    caughtUp = samples[j]![0] - samples[i]![0];
                    break;
                  }
                }
                lagMs.push(caughtUp < 0 ? -1 : Math.round(caughtUp * 10) / 10);
              }
            }
            resolve({
              frames: samples.length,
              framesInSync,
              changes,
              lagMs,
              audioAdvancedSec: Math.round((audio.currentTime - audioStart) * 10) / 10,
            });
          };
          requestAnimationFrame(tick);
        }),
      { turns: timings, seconds: 30 },
    );
    await page.keyboard.press("k");
    const caught = sync.lagMs.filter((ms) => ms >= 0);
    results.sync = {
      windowSec: 30,
      audioAdvancedSec: sync.audioAdvancedSec,
      frames: sync.frames,
      framesInSync: sync.framesInSync,
      lineChanges: sync.changes,
      neverCaughtUp: sync.lagMs.length - caught.length,
      lagMs: caught.length > 0 ? summarise(caught) : null,
    };
    save();
  } else {
    results.sync = "not measured: .env.local is needed to read the turn timings";
  }

  // Scrolling the hour-long transcript: frame intervals over two seconds of wheel scrolling.
  const transcript = page.getByRole("region", { name: "Transcript" });
  const box = await transcript.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const framesPromise = page.evaluate(
      () =>
        new Promise<{ frames: number; over50ms: number; worstMs: number }>((resolve) => {
          let last = performance.now();
          let frames = 0;
          let over50ms = 0;
          let worstMs = 0;
          const end = last + 2000;
          const tick = (now: number) => {
            const delta = now - last;
            last = now;
            frames++;
            if (delta > 50) over50ms++;
            if (delta > worstMs) worstMs = delta;
            if (now < end) requestAnimationFrame(tick);
            else resolve({ frames, over50ms, worstMs: Math.round(worstMs) });
          };
          requestAnimationFrame(tick);
        }),
    );
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(90);
    }
    results.scroll = await framesPromise;
  }

  // Audio: did the media load, and does storage support range requests?
  const audioInfo = await page.evaluate(async () => {
    const audio = document.querySelector("audio");
    if (!audio) return { present: false };
    return {
      present: true,
      preload: audio.preload,
      readyState: audio.readyState,
      hasSrc: Boolean(audio.currentSrc),
      durationSec: Number.isFinite(audio.duration) ? Math.round(audio.duration) : null,
    };
  });
  results.audio = audioInfo;

  results.interactions = Object.fromEntries(
    [...new Set(interactions.map((s) => s.label))].map((label) => [
      label,
      summarise(interactions.filter((s) => s.label === label).map((s) => s.ms)),
    ]),
  );

  // 3. Search (NFR Search: the server answers within 300 ms for 95% of searches). The
  // full page as the browser fetches it, fifteen terms, two timed requests each after a
  // warm one (forty-five hits, under the sixty a minute one client may make); and the
  // database function itself over Supabase's API, twenty terms three times, from here.
  const queries = [
    "overlap",
    "digits",
    "seat number",
    "microphone",
    "transcriber",
    "meeting",
    "budget",
    "schedule",
    "recording",
    "speaker",
    "language",
    "channel",
    "feature",
    "problem",
    "question",
  ];
  const searchSamples: number[] = [];
  const searchStatus: Record<string, string> = {};
  for (const query of queries) {
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const response = await page.request.get(`/search?q=${encodeURIComponent(query)}`);
      const ms = Date.now() - start;
      if (i > 0) searchSamples.push(ms); // the first request of each term warms the server
      searchStatus[query] = String(response.status());
    }
  }
  results.search = { fullPageMs: summarise(searchSamples), status: searchStatus, queries };
  const env = localEnv();
  if (env) {
    const functionSamples: number[] = [];
    const functionStatus = new Set<number>();
    for (const query of [...queries, "launch", "deadline", "design", "results", "data"]) {
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const response = await fetch(`${env.url}/rest/v1/rpc/search_meetings`, {
          method: "POST",
          headers: { apikey: env.publishableKey, "Content-Type": "application/json" },
          body: JSON.stringify({ p_query: query, p_limit: 120, p_own_only: false }),
        });
        await response.arrayBuffer();
        functionSamples.push(Date.now() - start);
        functionStatus.add(response.status);
      }
    }
    results.searchFunction = {
      note: "search_meetings() over Supabase's API from the test machine, as anon; includes the round trip",
      ms: summarise(functionSamples),
      status: [...functionStatus],
    };
  }

  // 4. The webhook (NFR Webhook: answers within 1 s). Without the secret this times the
  // path up to the signature check, which is where every forged call ends; a signed call
  // adds one indexed update.
  const webhookSamples: number[] = [];
  const webhookStatus = new Set<number>();
  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    const response = await page.request.post("/api/webhooks/attendee", {
      data: {
        bot_id: "bot_measurement",
        trigger: "bot.state_change",
        data: { new_state: "ended", event_type: "post_processing_completed" },
      },
      headers: { "x-webhook-signature": "forged" },
    });
    webhookSamples.push(Date.now() - start);
    webhookStatus.add(response.status());
  }
  results.webhook = {
    note: "a forged signature: the route reads the body and refuses; 503 means no secret is configured",
    ms: summarise(webhookSamples),
    status: [...webhookStatus],
  };

  results.problems = [...new Set(problems)];
  save();
  // The numbers are the point of this spec.
  // eslint-disable-next-line no-console
  console.log(`\nMETRICS ${project}\n${JSON.stringify(results, null, 2)}`);
  expect(interactionErrors).toEqual([]);
  expect(results.problems).toEqual([]);
});
