import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "";

export async function proxy(request: NextRequest) {
  // Some Supabase magic-link flows (or misconfiguration) can land users on the app root
  // with `?code=...`. Route that to our PKCE exchange handler.
  const code = request.nextUrl.searchParams.get("code");
  const basePath = request.nextUrl.basePath ?? "";
  if (code && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `${basePath}/auth/callback`;
    url.search = "";
    url.searchParams.set("code", code);
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return response;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
