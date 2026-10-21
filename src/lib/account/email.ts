import { getJson, postJson } from "./client";

export type EmailCapabilities = {
  email: boolean;
  newsletter: { enabled: boolean; label: string; defaultChecked: boolean };
};

export const NO_EMAIL: EmailCapabilities = {
  email: false,
  newsletter: { enabled: false, label: "", defaultChecked: false },
};

// The server enables email per instance (compass-themes identity/email.js), so
// the app asks before showing any address field. A server that predates the
// route answers 404, which reads as "off" and is asked again next time rather
// than remembered.
let cached: EmailCapabilities | null = null;
let inflight: Promise<EmailCapabilities> | null = null;

function parseCapabilities(raw: unknown): EmailCapabilities {
  const d = (raw ?? {}) as { email?: unknown; newsletter?: Record<string, unknown> };
  if (d.email !== true) return NO_EMAIL;
  const n = d.newsletter ?? {};
  const label = typeof n.label === "string" ? n.label.trim() : "";
  const newsletterOn = n.enabled === true && label.length > 0;
  return {
    email: true,
    newsletter: {
      enabled: newsletterOn,
      label: newsletterOn ? label : "",
      defaultChecked: newsletterOn && n.defaultChecked === true,
    },
  };
}

export function cachedEmailCapabilities(): EmailCapabilities | null {
  return cached;
}

export function loadEmailCapabilities(): Promise<EmailCapabilities> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = getJson<unknown>("/identity/api/capabilities")
    .then((raw) => {
      cached = parseCapabilities(raw);
      return cached;
    })
    .catch(() => NO_EMAIL)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

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
