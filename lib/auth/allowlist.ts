import { getAppAllowedEmails } from "@/lib/config";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowlistConfigured(): boolean {
  return getAppAllowedEmails().length > 0;
}

export function isEmailAllowed(email: string): boolean {
  const allowed = getAppAllowedEmails();
  if (allowed.length === 0) return true;
  return allowed.includes(normalizeEmail(email));
}
