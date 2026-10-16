/**
 * A meeting's address (2026-10-16): /m/<code> behind a four-digit PIN. The database
 * mints both with the meeting row (migration 39); these are the shapes and the words
 * the pages share. No I/O here.
 */
export const LINK_CODE = /^[a-z0-9]{12}$/;

/** The owner's view of their meeting's address. */
export type OwnerLink = { code: string; pin: string; enabled: boolean };
export const LINK_PIN = /^[0-9]{4}$/;

export function isLinkCode(value: string): boolean {
  return LINK_CODE.test(value);
}

/** The full address for a code, on the given origin. */
export function linkUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/m/${code}`;
}

/** The PIN as typed, digits only, or null when it is not four digits. */
export function cleanPin(value: string): string | null {
  const digits = value.replace(/\D+/g, "");
  return LINK_PIN.test(digits) ? digits : null;
}

/** One line to pass on: the address and the PIN. */
export function linkMessage(url: string, pin: string): string {
  return `${url} (PIN ${pin})`;
}
