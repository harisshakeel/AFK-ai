import { describe, expect, it } from "vitest";

import { findSender, matchesSender, normalizeName, profileNames, senderNames } from "./sender";

describe("names", () => {
  it("cleans a name the way Meet and Google write it", () => {
    expect(normalizeName("  Haris  Shakeel (2) ")).toBe("haris shakeel");
    expect(normalizeName("José Núñez-Ortega")).toBe("jose nunez ortega");
    expect(normalizeName("H.")).toBe("h");
    // A name in another script is kept, so an Urdu display name can match itself.
    expect(normalizeName(" حارث شکیل (2)")).toBe("حارث شکیل");
    expect(matchesSender("حارث", senderNames(["حارث شکیل"]))).toBe(true);
  });

  it("collects the sender's names without blanks or repeats", () => {
    expect(senderNames(["Haris Shakeel", null, "", "haris shakeel", "Haris", "H"])).toEqual([
      "haris shakeel",
      "haris",
    ]);
  });

  it("reads the Name and Name in calls lines of a profile", () => {
    const profile =
      "# Profile\n\n- Name: Haris Shakeel\n- Email: x@y.z\n- Name in calls: Haris S\n";
    expect(profileNames(profile)).toEqual(["Haris Shakeel", "Haris S"]);
    expect(profileNames("- Name:\n")).toEqual([]);
    expect(profileNames(null)).toEqual([]);
  });
});

describe("matching a speaker to the sender", () => {
  const names = senderNames(["Muhammad Haris Shakeel", "Haris"]);

  it("matches the same name, a shorter form and a longer form", () => {
    expect(matchesSender("Haris Shakeel", names)).toBe(true);
    expect(matchesSender("Haris", names)).toBe(true);
    expect(matchesSender("Muhammad Haris Shakeel", names)).toBe(true);
    expect(matchesSender("haris shakeel (2)", names)).toBe(true);
  });

  it("does not match a different person who shares a word", () => {
    expect(matchesSender("Haris Ahmed", senderNames(["Haris Shakeel"]))).toBe(false);
    expect(matchesSender("Asma Zahid", names)).toBe(false);
    expect(matchesSender("", names)).toBe(false);
  });
});

describe("finding the sender among the speakers", () => {
  const names = senderNames(["Haris Shakeel"]);

  it("takes the one speaker whose name matches", () => {
    expect(
      findSender(
        [
          { code: "a", label: "Asma Zahid" },
          { code: "b", label: "Haris Shakeel" },
        ],
        names,
      ),
    ).toEqual({ code: "b", by: "name" });
  });

  it("takes the only speaker when no name matches", () => {
    expect(findSender([{ code: "a", label: "Work Laptop" }], names)).toEqual({
      code: "a",
      by: "only",
    });
    expect(findSender([{ code: "a", label: "Work Laptop" }], [])).toEqual({
      code: "a",
      by: "only",
    });
  });

  it("takes nobody on a tie, or when several spoke and none matched", () => {
    expect(
      findSender(
        [
          { code: "a", label: "Haris" },
          { code: "b", label: "Haris Shakeel" },
        ],
        names,
      ),
    ).toBeNull();
    expect(
      findSender(
        [
          { code: "a", label: "Asma Zahid" },
          { code: "b", label: "Izbah Zahib" },
        ],
        names,
      ),
    ).toBeNull();
    expect(findSender([], names)).toBeNull();
  });
});
