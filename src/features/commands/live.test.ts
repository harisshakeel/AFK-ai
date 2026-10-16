import { describe, expect, it } from "vitest";

import { answerSchema, formatAnswerInput, groundAnswer } from "./answer";
import { detectLiveCommand, heardAcknowledgement } from "./live";

describe("live commands (requirement L2)", () => {
  it("acknowledges a command that waits for the final transcript, and nothing else", () => {
    expect(heardAcknowledgement("AFK, draft an email to Sam about the launch plan.")).toEqual({
      kind: "email",
      message: "Heard: email. It will wait for your approval on the Tasks tab after the call.",
    });
    expect(heardAcknowledgement("A F K, decision: we launch on the twentieth.")).toEqual({
      kind: "decision",
      message: "Heard: decision. It goes into the notes after the call.",
    });
    // Questions and recaps get an answer instead; no wake word, no command.
    expect(heardAcknowledgement("AFK, what did we decide about pricing?")).toBeNull();
    expect(heardAcknowledgement("Hello, AFK!")).toBeNull();
    expect(heardAcknowledgement("We launch on the twentieth.")).toBeNull();
  });

  it("hears a host's question or recap after the wake word, and nothing else", () => {
    expect(detectLiveCommand("AFK, what did we decide about pricing?")).toEqual({
      kind: "ask",
      question: "what did we decide about pricing?",
    });
    expect(detectLiveCommand("Hey A F K, recap the last ten minutes.")).toEqual({
      kind: "recap",
      question: "the last ten minutes.",
    });
    expect(detectLiveCommand("AFK, catch me up")).toMatchObject({ kind: "recap" });
    // Commands that wait for the final transcript are not live.
    expect(detectLiveCommand("AFK, decision: we launch on the twentieth.")).toBeNull();
    expect(detectLiveCommand("AFK, task for Sam: send the deck.")).toBeNull();
    // No wake word, no command.
    expect(detectLiveCommand("What did we decide about pricing?")).toBeNull();
    expect(detectLiveCommand("")).toBeNull();
  });

  it("formats the question and the lines as data, and keeps only citations that exist", () => {
    const lines = [
      { seq: 3, atSec: 65, speaker: "Sam", text: "We go with <blue>." },
      { seq: 4, atSec: 70, speaker: "Ana", text: "Agreed, blue it is." },
    ];
    const input = formatAnswerInput("what did we decide?", lines);
    expect(input).toContain("<host_said>\nwhat did we decide?\n</host_said>");
    expect(input).toContain("[3] 1:05 Sam: We go with ‹blue›.");
    const parsed = answerSchema.parse({ answer: "Blue.  Ana agreed.", cited: [4, 3, 99, 3] });
    expect(groundAnswer(parsed, lines)).toEqual({
      text: "Blue.  Ana agreed. (at 1:05)",
      cited: [4, 3],
      dropped: 1,
    });
    expect(groundAnswer({ answer: "That wasn't discussed yet.", cited: [] }, lines)).toEqual({
      text: "That wasn't discussed yet.",
      cited: [],
      dropped: 0,
    });
    expect(answerSchema.safeParse({ answer: "x".repeat(601), cited: [] }).success).toBe(false);
  });
});
