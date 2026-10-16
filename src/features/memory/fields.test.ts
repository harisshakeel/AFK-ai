import { describe, expect, it } from "vitest";

import { hasFields, parseFields, setField } from "./fields";
import { contextTemplate, LEARNED_MARKER, profileTemplate } from "./files";

describe("the fields view of a memory file", () => {
  it("is for the profile and the skills, not the free lists or AFK's files", () => {
    expect(hasFields("profile.md")).toBe(true);
    expect(hasFields("skills/email.md")).toBe(true);
    expect(hasFields("context/people.md")).toBe(false);
    expect(hasFields("history/actions.md")).toBe(false);
  });

  it("reads the profile's lines as fields under their headings, yes/no lines as a choice", () => {
    const groups = parseFields(
      profileTemplate({ name: "Tess", email: "t@example.com" }),
      "profile.md",
    );
    expect(groups.map((group) => group.heading)).toEqual(["Who I am", "How I like things"]);
    const who = groups[0]!.fields;
    expect(who.map((field) => `${field.key}=${field.value}`)).toEqual([
      "Name=Tess",
      "Name in calls=",
      "Email=t@example.com",
      "Role and company=",
      "Timezone=",
      "Language=English",
    ]);
    // A hint is shown, never written: the profile's names are read as written.
    expect(who[1]).toMatchObject({ placeholder: null, hint: expect.stringContaining("Meet") });
    const how = groups[1]!.fields;
    expect(how.find((field) => field.key === "AFK speaks in calls")).toMatchObject({
      kind: "yesno",
      value: "no",
    });
    // "- Only me (the host)" has no colon: not a field, it stays in the Markdown.
    expect(groups.some((group) => group.heading === "Who may give AFK commands")).toBe(false);
  });

  it("takes a skill's placeholders from the line, and from the template once the line lost it", () => {
    const groups = parseFields(contextTemplate("skills/email.md"), "skills/email.md");
    expect(groups.map((group) => group.heading)).toEqual(["Settings"]);
    const copy = groups[0]!.fields.find((field) => field.key === "Always copy")!;
    expect(copy).toMatchObject({
      value: "",
      placeholder: "addresses, comma separated, or leave empty",
    });
    const edited = setField(
      contextTemplate("skills/email.md"),
      copy.line,
      "sam@example.com",
      copy.placeholder,
    );
    expect(edited).toContain("- Always copy: sam@example.com\n");
    const again = parseFields(edited, "skills/email.md")[0]!.fields.find(
      (field) => field.key === "Always copy",
    )!;
    expect(again).toMatchObject({
      value: "sam@example.com",
      placeholder: "addresses, comma separated, or leave empty",
    });
    // The guidance (numbered) is not a field.
    expect(groups[0]!.fields.map((field) => field.key)).not.toContain("1. Open with the point");
  });

  it("rewrites one line and nothing else, the learned zone included; an emptied field gets its placeholder back", () => {
    const content = `# Profile\n\n## Who I am\n\n- Name: Tess\n- Name in calls:\n- Always copy: (addresses)\n${LEARNED_MARKER}\n- [2026-10-19] Sam: sam@example.com (Weekly)\n`;
    const [group] = parseFields(content, "profile.md");
    const nameInCalls = group!.fields[1]!;
    const filled = setField(content, nameInCalls.line, "Tess Tester ", null);
    expect(filled).toBe(
      `# Profile\n\n## Who I am\n\n- Name: Tess\n- Name in calls: Tess Tester \n- Always copy: (addresses)\n${LEARNED_MARKER}\n- [2026-10-19] Sam: sam@example.com (Weekly)\n`,
    );
    // Newlines cannot break out of the line.
    expect(setField(content, nameInCalls.line, "a\nb", null)).toContain("- Name in calls: a b\n");
    expect(setField(content, nameInCalls.line, "   ", null)).toContain("- Name in calls:\n");
    const copy = group!.fields[2]!;
    expect(setField(content, copy.line, "", copy.placeholder)).toContain(
      "- Always copy: (addresses)\n",
    );
    // A line that is not a field is left alone.
    expect(setField(content, 0, "x", null)).toBe(content);
  });
});
