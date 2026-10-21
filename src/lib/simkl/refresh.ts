import { safeFetch } from "@/lib/safe-fetch";
import { SIMKL_API_BASE, SIMKL_CLIENT_ID } from "./config";
import { sessionNeedsRefresh } from "./refresh-policy";
import { getSession, setSession } from "./session";

export type SimklTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** POST a form to /oauth2/*. No custom headers on purpose: keeps it a CORS "simple" request. */
export async function postOauth2(
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; json: SimklTokenResponse & Record<string, unknown> }> {
  const res = await safeFetch(`${SIMKL_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ client_id: SIMKL_CLIENT_ID, ...fields }),
  });
  const json = (await res.json().catch(() => ({}))) as SimklTokenResponse & Record<string, unknown>;
  return { status: res.status, json };
}

export { sessionNeedsRefresh };

let inflight: Promise<void> | null = null;

/** Swap the refresh token for a new access token. Safe to call from many requests at once. */
export function refreshSimklSession(): Promise<void> {
  if (inflight) return inflight;
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(): Promise<void> {
  const current = getSession();
  if (!current?.refreshToken) return;
  const { status, json } = await postOauth2("/oauth2/token", {
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  if (status === 200 && json.access_token) {
    // The refresh token is non-rotating, so keep ours unless Simkl sends one.
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 604800;
    setSession({
      ...current,
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? current.refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return;
  }
  // invalid_grant = the refresh token is dead; the next request will 401 and disconnect.
  // Anything else (network, 5xx) is transient: leave the session alone and let the caller retry later.
}
