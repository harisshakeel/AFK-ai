import type { NextConfig } from "next";

/**
 * Security headers for every response, static files included. Nothing on the site needs
 * to be framed, the browser must never sniff types, referrers stay on-origin, and the
 * page asks for no device access. The Content-Security-Policy is set per request in
 * src/proxy.ts, because its script rule needs a fresh nonce.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Nothing here loads remote images, so the image optimizer's remote fetching stays off.
  images: { remotePatterns: [] },
  // Server-only modules must never reach the browser bundle.
  serverExternalPackages: [],
  headers: async () => [{ source: "/(.*)", headers: SECURITY_HEADERS }],
};

export default nextConfig;
