import { BINGERS_SCOPE, BINGERS_VERIFY_URL } from "./config";
import type { BingersSession, DeviceCode } from "./types";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// The page we open for the user comes from the server, so only a bingers.app address
// over https is trusted; anything else falls back to the documented activation page.
function bingersPage(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    return host === "bingers.app" || host.endsWith(".bingers.app") ? url.href : null;
  } catch {
    return null;
  }
}

export function parseDeviceCode(data: unknown): DeviceCode | null {
  const o = asObject(data);
  const deviceCode = str(o?.device_code);
  const userCode = str(o?.user_code);
  if (!o || !deviceCode || !userCode) return null;
  return {
    deviceCode,
    userCode,
    verificationUrl: bingersPage(o.verification_uri) ?? BINGERS_VERIFY_URL,
    verificationUrlComplete: bingersPage(o.verification_uri_complete),
    expiresIn: positive(o.expires_in) ?? 600,
    pollIntervalSec: Math.max(1, positive(o.interval) ?? 5),
  };
}

/** OAuth answers `{ error: "code" }`; the REST API answers `{ error: { code } }`. */
export function errorCode(data: unknown): string | null {
  const o = asObject(data);
  if (!o) return null;
  if (typeof o.error === "string") return o.error;
  return str(asObject(o.error)?.code);
}

export function errorMessage(data: unknown, status: number): string {
  const o = asObject(data);
  return (
    str(o?.error_description) ??
    str(asObject(o?.error)?.message) ??
    (typeof o?.error === "string" ? o.error : null) ??
    `HTTP ${status}`
  );
}

export function sessionFromTokens(
  data: unknown,
  now: number,
  previous: BingersSession | null,
): BingersSession | null {
  const o = asObject(data);
  const accessToken = str(o?.access_token);
  if (!o || !accessToken) return null;
  return {
    accessToken,
    // A refresh that does not rotate the refresh token keeps the one already held.
    refreshToken: str(o.refresh_token) ?? previous?.refreshToken ?? null,
    expiresAt: now + (positive(o.expires_in) ?? 3600) * 1000,
    scope: str(o.scope) ?? previous?.scope ?? BINGERS_SCOPE,
    name: previous?.name ?? null,
    handle: previous?.handle ?? null,
    connectedAt: previous?.connectedAt ?? now,
  };
}

export type PollResult =
  | { kind: "authorized"; session: BingersSession }
  | { kind: "pending" }
  | { kind: "slow_down" }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export function classifyTokenPoll(status: number, data: unknown, now: number): PollResult {
  if (status >= 200 && status < 300) {
    const session = sessionFromTokens(data, now, null);
    return session
      ? { kind: "authorized", session }
      : { kind: "error", message: "Bingers answered without an access token" };
  }
  const code = errorCode(data);
  if (code === "authorization_pending") return { kind: "pending" };
  if (code === "slow_down") return { kind: "slow_down" };
  if (code === "expired_token") return { kind: "expired" };
  if (code === "access_denied") return { kind: "denied" };
  return { kind: "error", message: errorMessage(data, status) };
}

export type RefreshResult =
  | { kind: "ok"; session: BingersSession }
  | { kind: "revoked" }
  | { kind: "failed" };

export function classifyRefresh(
  status: number,
  data: unknown,
  now: number,
  previous: BingersSession,
): RefreshResult {
  if (status >= 200 && status < 300) {
    const session = sessionFromTokens(data, now, previous);
    return session ? { kind: "ok", session } : { kind: "failed" };
  }
  // invalid_grant: the user disconnected Compass on bingers.app, or the token rotated away.
  const code = errorCode(data);
  if (status === 401 || code === "invalid_grant" || code === "invalid_client") {
    return { kind: "revoked" };
  }
  return { kind: "failed" };
}

export type MeIdentity = { name: string | null; handle: string | null };

/** `/v1/me` is not in the published schema, so read the user from either nesting. */
export function parseMe(data: unknown): MeIdentity {
  const o = asObject(data);
  const user = asObject(o?.user) ?? o;
  return {
    name: str(user?.name) ?? str(user?.display_name),
    handle: str(user?.handle) ?? str(user?.username),
  };
}
