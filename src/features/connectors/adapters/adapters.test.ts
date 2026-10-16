import { describe, expect, it } from "vitest";

import { AdapterError } from "./adapter";
import { runCalendarCreate } from "./calendar-create";
import { runGmailSend } from "./gmail-send";
import { runSlackPost } from "./slack-post";

type Answer = { status: number; body: unknown } | { throws: string };

function fakeFetch(answers: Answer[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const answer = answers.shift();
    if (!answer) throw new Error("no scripted answer");
    if ("throws" in answer) throw new TypeError(answer.throws);
    return new Response(answer.body === null ? "" : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const email = { to: ["sam@example.com"], cc: [], subject: "Launch plan", body: "Hi Sam" };

describe("gmail-send", () => {
  it("sends once and reports the recipients", async () => {
    const fetch = fakeFetch([{ status: 200, body: { id: "m1", threadId: "t1" } }]);
    const result = await runGmailSend({ args: email, accessToken: "ya29", fetchImpl: fetch.impl });
    expect(result).toEqual({
      kind: "email",
      to: ["sam@example.com"],
      subject: "Launch plan",
      messageId: "m1",
    });
    expect((fetch.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer ya29",
    );
  });

  it("is final on a refusal and ambiguous when the network drops after the request left", async () => {
    const refused = fakeFetch([{ status: 403, body: {} }]);
    await expect(
      runGmailSend({ args: email, accessToken: "ya29", fetchImpl: refused.impl }),
    ).rejects.toMatchObject({
      name: "AdapterError",
      ambiguous: false,
      retryable: false,
    });
    const dropped = fakeFetch([{ throws: "fetch failed" }]);
    const error = await runGmailSend({
      args: email,
      accessToken: "ya29",
      fetchImpl: dropped.impl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).ambiguous).toBe(true);
    expect((error as AdapterError).message).toMatch(/may have been sent/);
  });
});

describe("calendar-create", () => {
  const commandId = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

  it("creates a follow-up with invitations and a client id", async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          id: "6f9619ff8b86d011b42d00c04fc964ff",
          htmlLink: "https://cal/e",
          start: { dateTime: "2026-10-28T15:00:00+05:00" },
          end: { dateTime: "2026-10-28T15:30:00+05:00" },
        },
      },
    ]);
    const result = await runCalendarCreate({
      kind: "followup",
      args: {
        title: "Follow-up",
        startsAt: "2026-10-28T15:00:00+05:00",
        durationMin: 30,
        attendees: ["sam@example.com"],
        description: null,
      },
      commandId,
      accessToken: "ya29",
      fetchImpl: fetch.impl,
    });
    expect(result).toMatchObject({
      kind: "followup",
      eventId: "6f9619ff8b86d011b42d00c04fc964ff",
      link: "https://cal/e",
      attendees: ["sam@example.com"],
    });
    const sent = JSON.parse(String(fetch.calls[0]!.init.body));
    expect(sent).toMatchObject({
      id: "6f9619ff8b86d011b42d00c04fc964ff",
      summary: "Follow-up",
      end: { dateTime: "2026-10-28T15:30:00+05:00" },
    });
    expect(fetch.calls[0]!.url).toContain("sendUpdates=all");
  });

  it("creates a reminder for the host alone with a popup, and says when a retry is safe", async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          id: "x",
          start: { dateTime: "2026-10-21T09:00:00+05:00" },
          end: { dateTime: "2026-10-21T09:15:00+05:00" },
        },
      },
      { status: 503, body: {} },
      { status: 400, body: {} },
    ]);
    const args = { text: "call the vendor", startsAt: "2026-10-21T09:00:00+05:00" };
    const result = await runCalendarCreate({
      kind: "remind",
      args,
      commandId,
      accessToken: "ya29",
      fetchImpl: fetch.impl,
    });
    expect(result).toMatchObject({ kind: "remind", text: "call the vendor" });
    const sent = JSON.parse(String(fetch.calls[0]!.init.body));
    expect(sent.attendees).toEqual([]);
    expect(sent.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 0 }],
    });
    expect(fetch.calls[0]!.url).toContain("sendUpdates=none");
    await expect(
      runCalendarCreate({
        kind: "remind",
        args,
        commandId,
        accessToken: "ya29",
        fetchImpl: fetch.impl,
      }),
    ).rejects.toMatchObject({ retryable: true });
    await expect(
      runCalendarCreate({
        kind: "remind",
        args,
        commandId,
        accessToken: "ya29",
        fetchImpl: fetch.impl,
      }),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe("slack-post", () => {
  const args = {
    channelId: "C0123456",
    channelName: "general",
    message: "The demo moved to Thursday.",
  };

  it("posts to the chosen channel and names the workspace", async () => {
    const fetch = fakeFetch([{ status: 200, body: { ok: true, ts: "1.2", channel: "C0123456" } }]);
    const result = await runSlackPost({
      args,
      botToken: "xoxb",
      teamName: "Acme",
      fetchImpl: fetch.impl,
    });
    expect(result).toEqual({
      kind: "slack",
      channelName: "general",
      message: args.message,
      ts: "1.2",
      teamName: "Acme",
    });
  });

  it("explains a missing channel plainly, and is ambiguous when the network drops", async () => {
    const missing = fakeFetch([{ status: 200, body: { ok: false, error: "channel_not_found" } }]);
    await expect(
      runSlackPost({ args, botToken: "xoxb", teamName: "Acme", fetchImpl: missing.impl }),
    ).rejects.toMatchObject({
      ambiguous: false,
      message: expect.stringMatching(/can't find that channel/),
    });
    const dropped = fakeFetch([{ throws: "fetch failed" }]);
    await expect(
      runSlackPost({ args, botToken: "xoxb", teamName: "Acme", fetchImpl: dropped.impl }),
    ).rejects.toMatchObject({ ambiguous: true });
  });
});
