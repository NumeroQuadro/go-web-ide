import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";

const OAUTH_PROVIDERS = {
  github: {
    label: "GitHub",
    scopes: "user:email",
  },
  google: {
    label: "Google",
    scopes: undefined,
  },
} as const;

type OAuthProvider = keyof typeof OAUTH_PROVIDERS;
type AuthSettingsResponse = {
  external?: Partial<Record<OAuthProvider, boolean>>;
};

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function getAppBaseUrlFromRequest(request: NextRequest): URL {
  const configured = getAppBaseUrl();
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      // fall back to request URL
    }
  }

  return new URL(request.nextUrl.origin);
}

function getCallbackUrl(request: NextRequest): string {
  const appBase = getAppBaseUrlFromRequest(request);
  const basePath = trimTrailingSlash(appBase.pathname);
  return new URL(`${basePath}/auth/callback`, appBase.origin).toString();
}

function redirectToLogin(
  request: NextRequest,
  error: string,
  provider?: string,
) {
  const appBase = getAppBaseUrlFromRequest(request);
  const basePath = trimTrailingSlash(appBase.pathname);
  const url = new URL(`${basePath}/login`, appBase.origin);
  url.searchParams.set("error", error);
  if (provider) {
    url.searchParams.set("provider", provider);
  }
  return NextResponse.redirect(url);
}

function isOAuthProvider(value: string): value is OAuthProvider {
  return value in OAUTH_PROVIDERS;
}

async function isProviderEnabled(provider: OAuthProvider): Promise<boolean | undefined> {
  try {
    const response = await fetch(`${getSupabaseUrl()}/auth/v1/settings`, {
      headers: {
        apikey: getSupabasePublishableKey(),
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as AuthSettingsResponse;
    const enabled = body.external?.[provider];
    return typeof enabled === "boolean" ? enabled : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider")?.trim().toLowerCase() ?? "";
  if (!isOAuthProvider(provider)) {
    return redirectToLogin(request, "oauth_provider_invalid");
  }

  const providerEnabled = await isProviderEnabled(provider);
  if (providerEnabled === false) {
    return redirectToLogin(request, "oauth_provider_disabled", provider);
  }

  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getCallbackUrl(request),
        scopes: OAUTH_PROVIDERS[provider].scopes,
      },
    });

    if (error || !data.url) {
      return redirectToLogin(request, "oauth_provider_disabled", provider);
    }

    return NextResponse.redirect(data.url);
  } catch {
    return redirectToLogin(request, "oauth_failed", provider);
  }
}
