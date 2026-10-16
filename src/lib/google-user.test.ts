import { describe, expect, it } from "vitest";

import { isGoogleUser, nameFromMetadata } from "./google-user";

describe("isGoogleUser", () => {
  it("is true for an identity Google signed in, and for a guest who continued with Google", () => {
    expect(isGoogleUser({ app_metadata: { providers: ["google"] } })).toBe(true);
    expect(
      isGoogleUser({ is_anonymous: false, app_metadata: { providers: ["anonymous", "google"] } }),
    ).toBe(true);
  });

  it("is false for a guest, an email-and-password account and a missing session", () => {
    expect(isGoogleUser({ is_anonymous: true, app_metadata: { providers: ["anonymous"] } })).toBe(
      false,
    );
    expect(isGoogleUser({ is_anonymous: false, app_metadata: { providers: ["email"] } })).toBe(
      false,
    );
    expect(isGoogleUser({ is_anonymous: false })).toBe(false);
    expect(isGoogleUser({ app_metadata: { providers: "google" } })).toBe(false);
    expect(isGoogleUser(null)).toBe(false);
    expect(isGoogleUser(undefined)).toBe(false);
  });
});

describe("nameFromMetadata", () => {
  it("takes the full name, else the name, trimmed; nothing for blanks or no metadata", () => {
    expect(nameFromMetadata({ full_name: "  Haris Shakeel ", name: "Haris" })).toBe(
      "Haris Shakeel",
    );
    expect(nameFromMetadata({ full_name: " ", name: "Haris" })).toBe("Haris");
    expect(nameFromMetadata({ full_name: 4 })).toBeNull();
    expect(nameFromMetadata(undefined)).toBeNull();
  });
});
