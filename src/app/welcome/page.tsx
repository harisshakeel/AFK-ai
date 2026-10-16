import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { googleIdentity, hasProfile } from "@/features/memory/memory-queries";
import { WelcomeFlow } from "@/features/memory/welcome-flow";
import { getViewer } from "@/server/auth/viewer";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The first thing after the first Google sign-in (requirement M10). Once profile.md
 * exists it never shows again. Signed out, ?preview=1 shows the flow without saving.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = nextParam && /^\/(?!\/)[\w\-/?=&%.]*$/.test(nextParam) ? nextParam : "/dashboard";
  const viewer = await getViewer();
  const signedIn = Boolean(viewer.userId && !viewer.isAnonymous);
  if (!signedIn) {
    if (params.preview === "1") return <WelcomeFlow name={null} next={next} preview />;
    redirect("/sign-in?next=%2Fwelcome");
  }
  if (await hasProfile()) redirect(next);
  const identity = await googleIdentity();
  return <WelcomeFlow name={identity.name} next={next} />;
}
