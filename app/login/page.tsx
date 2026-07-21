import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  access_denied:
    "Access denied. This app is allowlist-only when APP_ALLOWED_EMAILS is set.",
  auth_failed: "Sign-in failed. Try again.",
  missing_code: "Missing auth code. Try signing in again.",
  oauth_failed: "Third-party sign-in failed. Try again.",
  oauth_provider_invalid: "Unsupported sign-in provider.",
  supabase_not_configured:
    "Supabase env is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string | string[]; provider?: string | string[] }>;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();

  if (supabaseUrl && supabaseKey) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/workbench");
  }

  const resolved = searchParams ? await searchParams : undefined;
  const errorRaw = resolved?.error;
  const providerRaw = resolved?.provider;
  const errorKey = Array.isArray(errorRaw) ? errorRaw[0] : errorRaw ?? "";
  const providerKey = Array.isArray(providerRaw) ? providerRaw[0] : providerRaw ?? "";
  const providerLabel =
    providerKey === "google" ? "Google" : providerKey === "github" ? "GitHub" : "That";
  const errorMessage =
    errorKey === "oauth_provider_disabled"
      ? `${providerLabel} sign-in is not enabled for this project yet.`
      : errorMessages[errorKey];

  return (
    <div className="center">
      <div className="card">
        <h1>Sign in</h1>
        <p>
          Enter your email to receive a magic link. This is a hosted personal app;
          access may be restricted by <code>APP_ALLOWED_EMAILS</code>.
        </p>
        {!supabaseUrl || !supabaseKey ? (
          <div className="alert">{errorMessages.supabase_not_configured}</div>
        ) : (
          <>
            {errorMessage ? <div className="alert">{errorMessage}</div> : null}
            <LoginForm />
          </>
        )}
      </div>
    </div>
  );
}
