import { postJson } from "./client";

// Same rule as the server's normaliseEmail: permissive on purpose, it only
// rejects what cannot be an address. The verification mail is the real check.
export function normaliseEmail(value: string): string {
  const s = value.trim().toLowerCase();
  if (s.length < 3 || s.length > 254) return "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : "";
}

export async function attachEmail(email: string, newsletterOptIn: boolean): Promise<void> {
  await postJson(
    "/identity/api/email/attach",
    { email: normaliseEmail(email), newsletterOptIn },
    { bearer: true },
  );
}

export async function resendEmailVerification(): Promise<void> {
  await postJson("/identity/api/email/resend", {}, { bearer: true });
}

// Always succeeds for a well-formed request: the server answers the same way
// whether or not the address is on file, so the UI must say "if".
export async function requestPasswordReset(email: string): Promise<void> {
  await postJson("/identity/api/password/reset/request", { email: normaliseEmail(email) });
}
