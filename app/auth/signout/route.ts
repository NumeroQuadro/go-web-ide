import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function getAppBaseUrl(request: NextRequest): URL {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // fall back to request origin
    }
  }

  return new URL(request.nextUrl.origin);
}

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function getFallbackNextPath(basePath: string): string {
  return `${basePath}/login`;
}

function getNextPath(request: NextRequest): string {
  const appBase = getAppBaseUrl(request);
  const basePath = trimTrailingSlash(appBase.pathname);
  const next = request.nextUrl.searchParams.get("next");
  if (!next) return getFallbackNextPath(basePath);

  // Prevent open redirects. Only allow same-origin relative paths.
  if (!next.startsWith("/") || next.startsWith("//"))
    return getFallbackNextPath(basePath);

  if (basePath && (next === basePath || next.startsWith(`${basePath}/`))) return next;
  if (!basePath) return next;

  return `${basePath}${next}`;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const appBase = getAppBaseUrl(request);
  return NextResponse.redirect(new URL(getNextPath(request), appBase.origin));
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const appBase = getAppBaseUrl(request);
  return NextResponse.redirect(new URL(getNextPath(request), appBase.origin));
}
