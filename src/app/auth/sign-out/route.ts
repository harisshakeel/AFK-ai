import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/server/db/supabase-server";

/** Sign out (a form POST, so a link or image can't sign someone out). */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
