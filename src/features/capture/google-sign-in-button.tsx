"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Google sign-in. An anonymous visitor links Google to their existing identity, so their
 * highlights and ticks carry over; if that Google account already has an AFK identity,
 * it signs in to that one instead.
 */
export function GoogleSignInButton({
  next = "/dashboard",
  linkAnonymous = true,
}: {
  next?: string;
  /** False after a link conflict: sign straight in to the existing identity. */
  linkAnonymous?: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  const signIn = async () => {
    setState("busy");
    // Anything that throws (storage blocked, the network) must not leave the button on
    // "Opening Google…" for ever.
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { data } = await supabase.auth.getSession();
      if (linkAnonymous && data.session?.user.is_anonymous) {
        const { error } = await supabase.auth.linkIdentity({
          provider: "google",
          options: { redirectTo },
        });
        if (!error) return;
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) setState("error");
    } catch {
      setState("error");
    }
  };

  return (
    <>
      <Button variant="secondary" className="w-full" onClick={signIn} disabled={state === "busy"}>
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
          />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z" />
          <path
            fill="#EA4335"
            d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
          />
        </svg>
        {state === "busy" ? "Opening Google…" : "Continue with Google"}
      </Button>
      {state === "error" && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Google sign-in isn&apos;t available right now.
        </p>
      )}
    </>
  );
}
