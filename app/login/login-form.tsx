"use client";

import { type FormEvent, useCallback, useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSentTo(null);

      const trimmed = email.trim();
      if (!trimmed) {
        setError("Enter an email address.");
        return;
      }

      setSending(true);
      try {
        const response = await fetch("/go-web-ide/api/auth/magic-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: trimmed }),
        });

        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        if (!response.ok) {
          setError(payload?.error ?? "Sign-in failed. Try again.");
          return;
        }

        setSentTo(trimmed);
      } catch {
        setError("Could not reach the sign-in service. Try again.");
      } finally {
        setSending(false);
      }
    },
    [email],
  );

  return (
    <form onSubmit={onSubmit}>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {error ? <div className="alert">{error}</div> : null}
      {sentTo ? (
        <div style={{ marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
          Magic link sent to <span style={{ color: "var(--text)" }}>{sentTo}</span>.
          Check your inbox.
        </div>
      ) : null}

      <div className="row">
        <button className="button" type="submit" disabled={sending}>
          {sending ? "Sending…" : "Send magic link"}
        </button>
      </div>

      <div
        style={{
          margin: "16px 0 12px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 10,
          color: "var(--muted)",
          fontSize: 12,
        }}
      >
        <div style={{ height: 1, background: "var(--border)" }} />
        <span>or</span>
        <div style={{ height: 1, background: "var(--border)" }} />
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <a
          className="button secondary"
          href="/go-web-ide/api/auth/oauth?provider=google"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Continue with Google
        </a>
        <a
          className="button secondary"
          href="/go-web-ide/api/auth/oauth?provider=github"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Continue with GitHub
        </a>
      </div>
    </form>
  );
}
