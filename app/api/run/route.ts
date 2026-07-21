import { NextResponse } from "next/server";

import { isAllowlistConfigured, isEmailAllowed } from "@/lib/auth/allowlist";
import { getRunnerInternalUrl, getRunnerSharedSecret } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getWorkspaceRunTotalBytes,
  type WorkspaceRunFile,
  validateWorkspaceRunFiles,
} from "@/lib/workspace";

type PublicRunRequest = {
  files: WorkspaceRunFile[];
};

type RunnerRunResponse = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  truncated: boolean;
  internal_error: boolean;
};

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_BODY_BYTES = MAX_SOURCE_BYTES + 64 * 1024;
const RUNNER_FETCH_TIMEOUT_MS = 7_000;

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 500 },
    );
  }

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const email = data.user.email ?? "";
  if (isAllowlistConfigured() && (!email || !isEmailAllowed(email))) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "request_too_large" }, { status: 400 });
    }
  }

  let body: PublicRunRequest;
  try {
    body = (await request.json()) as PublicRunRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const files = Array.isArray(body.files) ? body.files : [];
  const validationError = validateWorkspaceRunFiles(files);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (getWorkspaceRunTotalBytes(files) > MAX_SOURCE_BYTES) {
    return NextResponse.json({ error: "files_too_large" }, { status: 400 });
  }

  const runnerUrl = getRunnerInternalUrl();
  const sharedSecret = getRunnerSharedSecret();
  if (!sharedSecret) {
    return NextResponse.json(
      { error: "runner_secret_not_configured" },
      { status: 500 },
    );
  }

  let runnerResponse: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    RUNNER_FETCH_TIMEOUT_MS,
  );
  try {
    runnerResponse = await fetch(`${runnerUrl}/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Runner-Secret": sharedSecret,
      },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const name =
      e && typeof e === "object" && "name" in e
        ? String((e as { name: unknown }).name)
        : "";
    if (name === "AbortError") {
      return NextResponse.json({ error: "runner_timeout" }, { status: 502 });
    }
    return NextResponse.json({ error: "runner_unreachable" }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }

  let runnerBody: RunnerRunResponse | { error?: string } | null = null;
  try {
    runnerBody = (await runnerResponse.json()) as RunnerRunResponse | { error?: string };
  } catch {
    // If the runner returns non-JSON, treat as an internal runner failure.
  }

  if (!runnerResponse.ok) {
    const runnerError =
      runnerBody && typeof runnerBody === "object" && "error" in runnerBody
        ? String((runnerBody as { error?: string }).error ?? "")
        : "";

    return NextResponse.json(
      { error: "runner_error", runner_status: runnerResponse.status, runner_error: runnerError },
      { status: 502 },
    );
  }

  if (!runnerBody || typeof runnerBody !== "object") {
    return NextResponse.json(
      { error: "runner_invalid_response" },
      { status: 502 },
    );
  }

  return NextResponse.json(runnerBody);
}
