import { NextRequest, NextResponse } from "next/server";

import { isAllowlistConfigured, isEmailAllowed } from "@/lib/auth/allowlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getAppBaseUrl(request: NextRequest): URL {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // fall back to request URL
    }
  }
  return new URL(request.nextUrl.origin);
}

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function redirectToAppPath(
  request: NextRequest,
  path: string,
  query?: Record<string, string>,
) {
  const appBase = getAppBaseUrl(request);
  const basePath = trimTrailingSlash(appBase.pathname);
  const url = new URL(`${basePath}${path}`, appBase.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return redirectToAppPath(request, "/login", { error: "missing_code" });
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectToAppPath(request, "/login", { error: "auth_failed" });
  }

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? "";

  if (isAllowlistConfigured() && (!email || !isEmailAllowed(email))) {
    await supabase.auth.signOut();
    return redirectToAppPath(request, "/login", { error: "access_denied" });
  }

  return redirectToAppPath(request, "/workbench");
}
