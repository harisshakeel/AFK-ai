import { describe, expect, it } from "vitest";

import {
  browserOffset,
  emailApprovedSchema,
  followupApprovedSchema,
  inputValueToIso,
  isoToInputValue,
  offsetOf,
  slackApprovedSchema,
  splitAddresses,
} from "./approve-args";
import { calendarEventId, endOf, insertCalendarEvent } from "./calendar";
import { buildRawEmail, encodeHeaderText, sendGmail, toBase64Url } from "./gmail";
import {
  decodeIdToken,
  exchangeGoogleCode,
  googleAuthUrl,
  refreshGoogleAccessToken,
} from "./google";
import { actionLine } from "./history";
import { appForKind, appReady, CONNECTOR_APPS, type ConnectorView } from "./registry";
import { exchangeSlackCode, listSlackChannels, postSlackMessage, slackAuthUrl } from "./slack";

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a script and records what was asked. */
function fakeFetch(answers: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const answer = answers.shift();
    if (!answer) throw new Error("no scripted answer");
    return new Response(answer.body === null ? "" : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const idToken = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

describe("Google OAuth", () => {
  it("asks for offline access with a forced consent and PKCE", () => {
    const url = new URL(
      googleAuthUrl({
        clientId: "id",
        redirectUri: "https://afk.test/connectors/google/callback",
        state: "nonce",
        codeChallenge: "chal",
        loginHint: "me@example.com",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("login_hint")).toBe("me@example.com");
  });

  it("exchanges the code, reads who connected from the id_token, and keeps the refresh token", async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          access_token: "ya29.a",
          expires_in: 3599,
          refresh_token: "1//0r",
          scope: "openid email https://www.googleapis.com/auth/gmail.send",
          id_token: idToken({
            iss: "https://accounts.google.com",
            aud: "id",
            sub: "123",
            email: "me@example.com",
            email_verified: true,
          }),
        },
      },
    ]);
    const tokens = await exchangeGoogleCode(
      { code: "c", codeVerifier: "v", clientId: "id", clientSecret: "s", redirectUri: "r" },
      fetch.impl,
    );
    expect(tokens).toEqual({
      accessToken: "ya29.a",
      expiresInSec: 3599,
      refreshToken: "1//0r",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
      subject: "123",
      email: "me@example.com",
    });
    const form = new URLSearchParams(String(fetch.calls[0]!.init.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("v");
    expect(String(fetch.calls[0]!.init.body)).not.toContain("ya29");
  });

  it("refuses an id_token for another app, and maps invalid_grant on refresh", async () => {
    expect(() =>
      decodeIdToken(idToken({ iss: "https://accounts.google.com", aud: "other", sub: "1" }), "id"),
    ).toThrow(/another app/);
    const fetch = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    await expect(
      refreshGoogleAccessToken(
        { refreshToken: "r", clientId: "id", clientSecret: "s" },
        fetch.impl,
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});

describe("Slack", () => {
  it("builds the install URL and reads the install back", async () => {
    const url = new URL(slackAuthUrl({ clientId: "id", redirectUri: "r", state: "n" }));
    expect(url.searchParams.get("scope")).toBe("chat:write,chat:write.public,channels:read");
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          ok: true,
          access_token: "xoxb-1",
          scope: "chat:write,channels:read",
          team: { id: "T1", name: "Acme" },
        },
      },
    ]);
    const install = await exchangeSlackCode(
      { code: "c", clientId: "id", clientSecret: "s", redirectUri: "r" },
      fetch.impl,
    );
    expect(install).toEqual({
      botToken: "xoxb-1",
      scopes: ["chat:write", "channels:read"],
      teamId: "T1",
      teamName: "Acme",
    });
  });

  it("lists channels sorted, posts with the bearer token, and surfaces ok:false", async () => {
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          ok: true,
          channels: [
            { id: "C2", name: "zebra" },
            { id: "C1", name: "general" },
            { id: "C3", name: "old", is_archived: true },
          ],
        },
      },
      { status: 200, body: { ok: true, ts: "1.2", channel: "C1" } },
      { status: 200, body: { ok: false, error: "channel_not_found" } },
    ]);
    expect(await listSlackChannels("xoxb", fetch.impl)).toEqual([
      { id: "C1", name: "general" },
      { id: "C2", name: "zebra" },
    ]);
    expect(
      await postSlackMessage({ token: "xoxb", channelId: "C1", text: "hi" }, fetch.impl),
    ).toEqual({ ts: "1.2", channelId: "C1" });
    const headers = fetch.calls[1]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer xoxb");
    expect(JSON.parse(String(fetch.calls[1]!.init.body))).toEqual({ channel: "C1", text: "hi" });
    await expect(
      postSlackMessage({ token: "xoxb", channelId: "C9", text: "hi" }, fetch.impl),
    ).rejects.toMatchObject({ code: "channel_not_found" });
  });
});

describe("Gmail", () => {
  it("builds an RFC 5322 message with encoded headers and a base64 body", () => {
    const raw = buildRawEmail({
      to: ["sam@example.com", "not an address", "lee@example.org"],
      subject: "Launch plan: the twentieth",
      body: "Hi Sam,\n\nWe agreed to launch on the twentieth.\n\nThanks",
    });
    const [headers, body] = raw.split("\r\n\r\n");
    expect(headers!.split("\r\n")).toEqual([
      "To: sam@example.com, lee@example.org",
      "Subject: Launch plan: the twentieth",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ]);
    expect(Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe(
      "Hi Sam,\r\n\r\nWe agreed to launch on the twentieth.\r\n\r\nThanks",
    );
    expect(encodeHeaderText("Résumé\r\nX-Injected: yes")).toBe(
      `=?UTF-8?B?${Buffer.from("Résumé X-Injected: yes").toString("base64")}?=`,
    );
    expect(() => buildRawEmail({ to: ["nobody"], subject: "s", body: "b" })).toThrow(/recipient/);
    expect(toBase64Url("a+b/c")).toBe(Buffer.from("a+b/c").toString("base64url"));
  });

  it("sends with the bearer token and maps refusals", async () => {
    const fetch = fakeFetch([
      { status: 200, body: { id: "m1", threadId: "t1" } },
      { status: 403, body: { error: { message: "insufficient scope" } } },
    ]);
    expect(
      await sendGmail({ accessToken: "ya29", raw: "To: a@b.co\r\n\r\nhi" }, fetch.impl),
    ).toEqual({ messageId: "m1", threadId: "t1" });
    expect(fetch.calls[0]!.url).toContain("/users/me/messages/send");
    await expect(sendGmail({ accessToken: "ya29", raw: "x" }, fetch.impl)).rejects.toMatchObject({
      code: "auth",
    });
  });
});

describe("Calendar", () => {
  it("derives a base32hex event id from the command and computes the end with the same offset", () => {
    expect(calendarEventId("6F9619FF-8B86-D011-B42D-00C04FC964FF")).toBe(
      "6f9619ff8b86d011b42d00c04fc964ff",
    );
    expect(endOf("2026-10-28T15:00:00+05:00", 30)).toBe("2026-10-28T15:30:00+05:00");
    expect(endOf("2026-10-28T23:45:00-02:30", 45)).toBe("2026-10-29T00:30:00-02:30");
    expect(endOf("2026-10-28T10:00:00Z", 60)).toBe("2026-10-28T11:00:00.000Z");
  });

  it("inserts once, and reads an existing event back on 409", async () => {
    const event = {
      id: "abc123",
      title: "Follow-up",
      description: null,
      startsAt: "2026-10-28T15:00:00+05:00",
      endsAt: "2026-10-28T15:30:00+05:00",
      attendees: ["sam@example.com"],
      popupAtStart: false,
    };
    const fetch = fakeFetch([
      {
        status: 200,
        body: {
          id: "abc123",
          htmlLink: "https://cal/x",
          start: { dateTime: event.startsAt },
          end: { dateTime: event.endsAt },
        },
      },
      { status: 409, body: null },
      {
        status: 200,
        body: {
          id: "abc123",
          htmlLink: "https://cal/x",
          start: { dateTime: event.startsAt },
          end: { dateTime: event.endsAt },
        },
      },
    ]);
    const first = await insertCalendarEvent({ accessToken: "ya29", event }, fetch.impl);
    expect(first).toMatchObject({
      eventId: "abc123",
      link: "https://cal/x",
      alreadyExisted: false,
    });
    expect(fetch.calls[0]!.url).toContain("sendUpdates=all");
    expect(JSON.parse(String(fetch.calls[0]!.init.body))).toMatchObject({
      id: "abc123",
      attendees: [{ email: "sam@example.com" }],
    });
    const second = await insertCalendarEvent({ accessToken: "ya29", event }, fetch.impl);
    expect(second.alreadyExisted).toBe(true);
    expect(fetch.calls[2]!.init.method).toBe("GET");
  });
});

describe("approval arguments", () => {
  it("accept exactly what an adapter needs and nothing looser", () => {
    expect(emailApprovedSchema.safeParse({ to: ["a@b.co"], subject: "s", body: "b" }).success).toBe(
      true,
    );
    expect(emailApprovedSchema.safeParse({ to: [], subject: "s", body: "b" }).success).toBe(false);
    expect(emailApprovedSchema.safeParse({ to: ["bad"], subject: "s", body: "b" }).success).toBe(
      false,
    );
    expect(
      followupApprovedSchema.safeParse({
        title: "t",
        startsAt: "2026-10-28T15:00:00+05:00",
        durationMin: 30,
      }).success,
    ).toBe(true);
    expect(
      followupApprovedSchema.safeParse({ title: "t", startsAt: "next tuesday", durationMin: 30 })
        .success,
    ).toBe(false);
    expect(
      slackApprovedSchema.safeParse({ channelId: "C0123456", channelName: "general", message: "m" })
        .success,
    ).toBe(true);
    expect(
      slackApprovedSchema.safeParse({ channelId: "general", channelName: "general", message: "m" })
        .success,
    ).toBe(false);
    expect(splitAddresses("a@b.co, <c@d.co>; a@b.co\n e@f.co")).toEqual([
      "a@b.co",
      "c@d.co",
      "e@f.co",
    ]);
  });

  it("keeps the spoken wall-clock time between the input and the ISO value", () => {
    expect(isoToInputValue("2026-10-28T15:00:00+05:00")).toBe("2026-10-28T15:00");
    expect(offsetOf("2026-10-28T15:00:00+05:00")).toBe("+05:00");
    expect(offsetOf("2026-10-28T15:00:00Z")).toBe("Z");
    expect(offsetOf("2026-10-28T15:00")).toBeNull();
    expect(inputValueToIso("2026-10-28T15:00", "+05:00")).toBe("2026-10-28T15:00:00+05:00");
    expect(
      inputValueToIso("2026-10-28T15:00", browserOffset(new Date("2026-10-28T10:00:00Z"))),
    ).toMatch(/^2026-10-28T15:00:00[+-]\d{2}:\d{2}$/);
    expect(inputValueToIso("tuesday", "+05:00")).toBeNull();
    expect(inputValueToIso("2026-10-28T15:00", "soon")).toBeNull();
    expect(isoToInputValue(null)).toBe("");
  });
});

describe("address book and history", () => {
  it("writes one history line per kind", () => {
    const at = "2026-10-20T14:02:00Z";
    expect(
      actionLine(
        at,
        { kind: "email", to: ["sam@example.com"], subject: "Launch plan", messageId: "m" },
        "Weekly sync",
      ),
    ).toBe('- [2026-10-20 14:02] Sent "Launch plan" to sam@example.com (Weekly sync)');
    expect(
      actionLine(
        at,
        {
          kind: "followup",
          title: "Follow-up",
          startsAt: "2026-10-28T15:00:00+05:00",
          attendees: ["a@b.co", "c@d.co"],
          eventId: "e",
          link: null,
        },
        null,
      ),
    ).toBe(
      '- [2026-10-20 14:02] Put "Follow-up" on the calendar for 2026-10-28 15:00 with 2 invitations',
    );
    expect(
      actionLine(
        at,
        {
          kind: "slack",
          channelName: "general",
          message: "The demo moved to Thursday.",
          ts: "1",
          teamName: "Acme",
        },
        "Sync",
      ),
    ).toBe('- [2026-10-20 14:02] Posted to #general in Acme: "The demo moved to Thursday." (Sync)');
  });

  it("knows which app a kind needs and when it is ready", () => {
    expect(appForKind("email")?.id).toBe("gmail");
    expect(appForKind("remind")?.id).toBe("google-calendar");
    expect(appForKind("decision")).toBeNull();
    const google: ConnectorView = {
      id: "1",
      provider: "google",
      account: "me@example.com",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
      config: {},
      status: "connected",
      connectedAt: "2026-10-20T00:00:00Z",
      lastUsedAt: null,
      expiresHintAt: null,
    };
    const [gmail, calendar, slack] = CONNECTOR_APPS;
    expect(appReady(gmail!, [google])).toBe(true);
    expect(appReady(calendar!, [google])).toBe(false);
    expect(appReady(slack!, [{ ...google, provider: "slack", config: {} }])).toBe(false);
    expect(appReady(slack!, [{ ...google, provider: "slack", config: { channelId: "C1" } }])).toBe(
      true,
    );
    expect(appReady(gmail!, [{ ...google, status: "expired" }])).toBe(false);
  });
});
