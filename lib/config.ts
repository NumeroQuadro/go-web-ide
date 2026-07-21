export function getRunnerInternalUrl(): string {
  const raw = process.env.RUNNER_INTERNAL_URL?.trim();
  return raw ? raw : "http://127.0.0.1:8081";
}

export function getRunnerSharedSecret(): string | undefined {
  const raw = process.env.RUNNER_SHARED_SECRET?.trim();
  return raw ? raw : undefined;
}

export function getAppAllowedEmails(): string[] {
  const raw = process.env.APP_ALLOWED_EMAILS?.trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

export function getAppBaseUrl(): string | undefined {
  const raw = process.env.APP_BASE_URL?.trim();
  return raw ? raw : undefined;
}
