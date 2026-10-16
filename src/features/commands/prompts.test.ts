import { describe, expect, it } from "vitest";

import { commandsInstruction, formatCommandsExtra } from "./prompts";

describe("the command parser's message", () => {
  it("names the host, the meeting's address and PIN when the link is on, and lists the commands", () => {
    const extra = formatCommandsExtra(
      [
        {
          id: "t1",
          kind: "email",
          turnId: "t1",
          sentence: "AFK, email Shumail the recording.",
          rest: "email Shumail the recording.",
        },
      ],
      "Haris",
      { url: "https://afk.example/m/abcdefghjkmn", pin: "0420" },
    );
    expect(extra).toContain("Host: Haris");
    expect(extra).toContain("Meeting link: https://afk.example/m/abcdefghjkmn");
    expect(extra).toContain("Meeting PIN: 0420");
    expect(extra).toContain("id: t1");
    expect(formatCommandsExtra([], null, null)).toContain("Meeting link: none");
    expect(commandsInstruction()).toContain("never write a placeholder for a link");
  });
});
