import { getJson } from "./client";

export type AccountCapabilities = {
  email: boolean;
  newsletter: { enabled: boolean; label: string; defaultChecked: boolean };
  discord: boolean;
};

export const NO_CAPABILITIES: AccountCapabilities = {
  email: false,
  newsletter: { enabled: false, label: "", defaultChecked: false },
  discord: false,
};

// The server enables email and Discord per instance, so the app asks before
// showing either. A server that predates the route answers 404, which reads as
// "everything off" and is asked again next time rather than remembered.
let cached: AccountCapabilities | null = null;
let inflight: Promise<AccountCapabilities> | null = null;

function parseCapabilities(raw: unknown): AccountCapabilities {
  const d = (raw ?? {}) as {
    email?: unknown;
    newsletter?: Record<string, unknown>;
    discord?: unknown;
  };
  const discord = d.discord === true;
  if (d.email !== true) return { ...NO_CAPABILITIES, discord };
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
    discord,
  };
}

export function cachedAccountCapabilities(): AccountCapabilities | null {
  return cached;
}

export function loadAccountCapabilities(): Promise<AccountCapabilities> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = getJson<unknown>("/identity/api/capabilities")
    .then((raw) => {
      cached = parseCapabilities(raw);
      return cached;
    })
    .catch(() => NO_CAPABILITIES)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
