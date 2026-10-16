import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEARNED_MARKER,
  PROMPT_FILE_LIMIT_BYTES,
  PROMPT_TOTAL_LIMIT_BYTES,
  SKILL_PATHS,
  chooseMemoryFile,
  learnedLine,
  profileFromAnswers,
  profileTemplate,
  promptBlock,
  splitZones,
  channelForTopic,
  contextTemplate,
  isMemoryPath,
  parseSkill,
  profileSays,
  skillsBlock,
} from "./files";

describe("memory files", () => {
  it("reads a yes-or-no line of the profile, or says it is not there", () => {
    const profile =
      "# Profile\n\n- Email me after each meeting: no\n- AFK joins my calendar meetings: Yes\n- Notes: short\n";
    expect(profileSays(profile, "Email me after each meeting")).toBe(false);
    expect(profileSays(profile, "AFK joins my calendar meetings")).toBe(true);
    expect(profileSays(profile, "Notes")).toBeNull();
    // Either bullet, as the Memory page's fields read and write them.
    const starred = "* AFK joins my calendar meetings: yes";
    expect(profileSays(starred, "AFK joins my calendar meetings")).toBe(true);
    expect(profileSays(profile, "Missing")).toBeNull();
    expect(profileSays(null, "Anything")).toBeNull();
    // The template says yes to the note and no to the calendar.
    const fresh = profileTemplate({ name: "Tess", email: "t@example.com" });
    expect(profileSays(fresh, "Email me after each meeting")).toBe(true);
    expect(profileSays(fresh, "AFK joins my calendar meetings")).toBe(false);
  });

  it("knows the three skills as files with templates, reads them as settings, and offers them as data", () => {
    expect(isMemoryPath("skills/email.md")).toBe(true);
    expect(isMemoryPath("skills/anything.md")).toBe(false);
    const email = parseSkill(contextTemplate("skills/email.md"));
    expect(email).toMatchObject({ tone: "friendly and direct", "sign-off": "Best, {my name}" });
    // A placeholder in parentheses is not a setting, and the numbered guidance is not either.
    expect(email["always copy"]).toBeUndefined();
    expect(Object.keys(email).sort()).toEqual(["greeting", "length", "never", "sign-off", "tone"]);
    const calendar = parseSkill(contextTemplate("skills/calendar.md"));
    expect(calendar["default length"]).toBe("30 minutes");
    expect(calendar).toMatchObject({ "working hours": "10:00 to 18:00", "morning means": "10:00" });
    expect(calendar["always invite"]).toBeUndefined();
    // The Slack template routes nothing by itself: its example lives in prose.
    const slackTemplate = parseSkill(contextTemplate("skills/slack.md"));
    expect(Object.values(slackTemplate).some((value) => value.startsWith("#"))).toBe(false);
    expect(channelForTopic("the launch moves to Friday", slackTemplate)).toBeNull();
    // Each template leaves most of the prompt's per-file budget to the host's own lines.
    for (const path of SKILL_PATHS) {
      expect(new TextEncoder().encode(contextTemplate(path)).length).toBeLessThan(
        PROMPT_FILE_LIMIT_BYTES / 3,
      );
    }
    // The host's own lines, topic to channel, and only the user's zone counts.
    const slack = parseSkill(
      `# Slack skill\n- Tone: terse\n- launch: #launches\n- Design review: #design\n${LEARNED_MARKER}\n- [2026-11-02] ignored: #nope\n`,
    );
    expect(slack).toEqual({ tone: "terse", launch: "#launches", "design review": "#design" });
    expect(channelForTopic("The launch moved to Thursday", slack)).toBe("launches");
    expect(channelForTopic("Design review notes are up", slack)).toBe("design");
    expect(channelForTopic("Nothing about those", slack)).toBeNull();
    const block = skillsBlock([
      { path: "skills/email.md", content: "# Email skill\n- Tone: warm <b>\n" },
      { path: "context/people.md", content: "- Sam" },
    ]);
    expect(block).toContain("<host_skills>");
    expect(block).toContain("### skills/email.md");
    expect(block).toContain("Tone: warm ‹b›");
    expect(block).not.toContain("people.md");
    expect(skillsBlock([])).toBe("");
  });

  it("migration 36 carries the three templates verbatim, so untouched files become exactly these", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261016000036_skill_defaults.sql"),
      "utf8",
    );
    for (const path of SKILL_PATHS) {
      expect(sql).toContain(`where path = '${path}'`);
      expect(sql).toContain(`$new$${contextTemplate(path)}$new$`);
    }
  });

  it("splits the user's zone from what AFK learned", () => {
    const content = `# People\n\n- Sam: designer\n${LEARNED_MARKER}\n- [2026-10-27] Sam leads design on Atlas (Weekly sync)\n- [2026-10-27] Priya is the client's PM (Kickoff)\n`;
    expect(splitZones(content)).toEqual({
      user: "# People\n\n- Sam: designer\n",
      learned: [
        "- [2026-10-27] Sam leads design on Atlas (Weekly sync)",
        "- [2026-10-27] Priya is the client's PM (Kickoff)",
      ],
    });
    expect(splitZones("# People\n")).toEqual({ user: "# People\n", learned: [] });
  });

  it("seeds the profile from Google and fills it from the welcome answers", () => {
    const seeded = profileTemplate({ name: "Haris Shakeel", email: "h@example.com" });
    expect(seeded).toContain("- Name: Haris Shakeel");
    expect(seeded).toContain("- Email: h@example.com");
    const filled = profileFromAnswers(
      { name: "Haris Shakeel", email: "h@example.com" },
      {
        callMe: "Haris",
        roleAndCompany: "Founder, AFK",
        meetingsAre: "client calls",
        notesStyle: "short bullets",
        wantMost: "chase action items\nfor me",
        timezone: "Asia/Karachi",
      },
    );
    expect(filled).toContain("- Name: Haris");
    expect(filled).toContain("- Role and company: Founder, AFK");
    expect(filled).toContain("- What I most want AFK to do: chase action items for me");
    expect(filled).toContain("- Timezone: Asia/Karachi");
    expect(filled).toContain("- Language: English");
  });

  it("files a remembered line where it belongs", () => {
    expect(chooseMemoryFile("Sam is the designer on Atlas")).toBe("context/people.md");
    expect(chooseMemoryFile("CRM stands for customer relationship management")).toBe(
      "context/glossary.md",
    );
    expect(chooseMemoryFile("the launch moved to the twentieth")).toBe("context/projects.md");
    expect(learnedLine("2026-10-27", "Sam is the designer on Atlas.", "Weekly sync")).toBe(
      "- [2026-10-27] Sam is the designer on Atlas (Weekly sync)",
    );
  });

  it("builds the prompt block within the budget, newest history last, and never as instructions", () => {
    const longLearned = Array.from(
      { length: 400 },
      (_, index) => `- [2026-10-27] fact number ${index} about someone (Meeting ${index})`,
    );
    const history = Array.from(
      { length: 50 },
      (_, index) => `- [2026-10-0${(index % 9) + 1}] Meeting ${index}`,
    );
    const block = promptBlock([
      { path: "profile.md", content: "# Profile\n\n- Name: Haris <script>" },
      {
        path: "context/people.md",
        content: `# People\n${LEARNED_MARKER}\n${longLearned.join("\n")}\n`,
      },
      { path: "history/meetings.md", content: history.join("\n") },
      { path: "history/actions.md", content: "- [2026-10-27 10:00] Sent an email" },
    ]);
    expect(block.startsWith("<about_host>")).toBe(true);
    expect(block).toContain("### profile.md");
    expect(block).toContain("- Name: Haris ‹script›");
    // The people file was trimmed to the newest learned lines.
    expect(block).toContain("fact number 399");
    expect(block).not.toContain("fact number 0 ");
    const people = block.slice(
      block.indexOf("### context/people.md"),
      block.indexOf("### history"),
    );
    expect(new TextEncoder().encode(people).length).toBeLessThanOrEqual(
      PROMPT_FILE_LIMIT_BYTES + 64,
    );
    // Only the last 20 meetings, and never the actions log.
    expect(block).toContain("Meeting 49");
    expect(block).not.toContain("Meeting 10\n");
    expect(block).not.toContain("history/actions.md");
    expect(promptBlock([])).toBe("");
  });

  it("over the whole budget, drops the oldest learned lines across files before any file", () => {
    // Four files at the per-file limit each, plus history: about 34 KB, over the 32 KB budget.
    const learned = (month: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) =>
          `- [2026-${month}-${String((index % 28) + 1).padStart(2, "0")}] a fact about ${"x".repeat(60)} ${index}`,
      );
    const block = promptBlock([
      { path: "profile.md", content: `# Profile\n\n${"- a line about me\n".repeat(450)}` },
      {
        path: "context/people.md",
        content: `# People\n${LEARNED_MARKER}\n${learned("01", 84).join("\n")}\n`,
      },
      {
        path: "context/projects.md",
        content: `# Projects\n${LEARNED_MARKER}\n${learned("09", 84).join("\n")}\n`,
      },
      {
        path: "context/glossary.md",
        content: `# Glossary\n${LEARNED_MARKER}\n${learned("05", 84).join("\n")}\n`,
      },
      { path: "history/meetings.md", content: learned("10", 30).join("\n") },
    ]);
    expect(new TextEncoder().encode(block).length).toBeLessThanOrEqual(
      PROMPT_TOTAL_LIMIT_BYTES + 400,
    );
    // Every file is still there; it is January's lines (the oldest) that went.
    for (const path of [
      "profile.md",
      "context/people.md",
      "context/projects.md",
      "context/glossary.md",
      "history/meetings.md",
    ]) {
      expect(block).toContain(`### ${path}`);
    }
    expect(block).not.toContain("[2026-01-01]");
    expect(block).toContain("[2026-10-19]");
    expect(block).toContain("[2026-10-");
  });
});
