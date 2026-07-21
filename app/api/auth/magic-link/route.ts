import { NextResponse } from "next/server";

import { isAllowlistConfigured, isEmailAllowed } from "@/lib/auth/allowlist";
import { getAppBaseUrl } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MagicLinkRequest = {
  email: string;
};

const MAX_BODY_BYTES = 8 * 1024;

function messageForSupabaseError(status: number, message: string): string {
  if (status === 429) {
    return "Too many sign-in requests. Stop retrying for now and try again later.";
  }

  return message;
}

function getCallbackUrl(request: Request): string {
  const configuredBaseUrl = getAppBaseUrl();
  const baseUrl = configuredBaseUrl
    ? configuredBaseUrl.replace(/\/+$/, "")
    : new URL("/goofy-editor", request.url).toString().replace(/\/+$/, "");

  return `${baseUrl}/auth/callback`;
}

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request is too large." }, { status: 400 });
    }
  }

  let body: MagicLinkRequest;
  try {
    body = (await request.json()) as MagicLinkRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json({ error: "Enter an email address." }, { status: 400 });
  }

  if (isAllowlistConfigured() && !isEmailAllowed(email)) {
    return NextResponse.json(
      { error: "Access denied for this email address." },
      { status: 403 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getCallbackUrl(request),
      },
    });

    if (error) {
      const status =
        typeof error.status === "number" && error.status >= 400 ? error.status : 400;
      return NextResponse.json(
        { error: messageForSupabaseError(status, error.message) },
        { status },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Sign-in service is temporarily unavailable." },
      { status: 502 },
    );
  }
}
