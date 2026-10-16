/**
 * The Content-Security-Policy for every HTML response, built in the proxy with a fresh
 * nonce per request. Scripts run only with the nonce (Next.js stamps its own inline
 * scripts with it; `strict-dynamic` lets those load the chunks they need). Styles allow
 * inline because React sets speaker colours and positions as style attributes. The
 * browser talks only to this site and the Supabase project (auth, data, the seed audio);
 * a recording may also play from the bot provider's storage (media-src, below).
 */
export function buildContentSecurityPolicy({
  nonce,
  supabaseOrigin,
  isDev,
}: {
  nonce: string;
  supabaseOrigin: string;
  isDev: boolean;
}): string {
  const directives = [
    "default-src 'self'",
    // React reconstructs server error stacks with eval in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin}`,
    // Recordings: the seed audio from Supabase Storage, and a bot meeting's video from
    // wherever the bot provider's storage answers its short-lived links (an address
    // not known in advance). A media source can neither run script nor read the page.
    `media-src 'self' ${supabaseOrigin} https:`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** 128 random bits as base64: unguessable, and legal in an HTML attribute. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
