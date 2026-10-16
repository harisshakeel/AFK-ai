import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing a connector's long-lived token before it reaches the database (NFR Token
 * safety). AES-256-GCM under a 32-byte key that only the server holds
 * (CONNECTOR_TOKEN_KEY, base64). The database alone cannot reveal a token; a tampered
 * ciphertext fails to open; and a token sealed for one connector row cannot be opened
 * as another's: the owner and provider are bound in as authenticated data, so a
 * ciphertext moved onto another row fails to open. Format: "v2.<iv>.<ciphertext>.<tag>",
 * each base64url. "v1" values, sealed before the binding, still open without it.
 */
const VERSION = "v2";
const LEGACY_VERSION = "v1";
const IV_BYTES = 12;

export function parseTokenKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("CONNECTOR_TOKEN_KEY must be 32 random bytes, base64 encoded");
  }
  return key;
}

/** A fresh key for .env.local: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. */
export function newTokenKey(): string {
  return randomBytes(32).toString("base64");
}

/** What a token is bound to: the row it belongs to, as "<owner id>:<provider>". */
export function tokenBinding(ownerId: string, provider: string): string {
  return `${ownerId}:${provider}`;
}

export function sealSecret(plain: string, keyBase64: string, binding: string): string {
  const key = parseTokenKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function openSecret(sealed: string, keyBase64: string, binding: string): string {
  const key = parseTokenKey(keyBase64);
  const [version, ivPart, ciphertextPart, tagPart, ...rest] = sealed.split(".");
  const known = version === VERSION || version === LEGACY_VERSION;
  if (!known || !ivPart || !ciphertextPart || !tagPart || rest.length > 0) {
    throw new Error("sealed secret is malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  if (version === VERSION) decipher.setAAD(Buffer.from(binding, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("sealed secret cannot be opened");
  }
}
