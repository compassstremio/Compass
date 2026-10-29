import { TRAKT_API_BASE, TRAKT_API_VERSION, TRAKT_CLIENT_ID, TRAKT_TOKEN_PROXY } from "./config";
import { getSession, setSession } from "./session";
import type { TraktSession } from "./types";

export type TraktRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  authed?: boolean;
  assertCurrent?: () => void;
};

export class TraktApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Trakt HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

function baseHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "trakt-api-version": TRAKT_API_VERSION,
    "trakt-api-key": TRAKT_CLIENT_ID,
  };
}

/**
 * The Compass token proxy is not Trakt: it only accepts `Content-Type` (anything else
 * fails its CORS preflight, which silently killed every refresh while the device-token
 * login, which sends just this header, kept working).
 */
function proxyHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

const REFUSAL_BODY_TIMEOUT_MS = 3000;

/**
 * Trakt answers a spent or revoked refresh token with `{"error":"invalid_grant"}`.
 * Anything else with the same status (a Cloudflare page, the proxy's `bad_json`, an
 * `invalid_client` from a rotated secret) says nothing about this token, so the
 * session stays. The read is bounded because the refresh is shared by every caller.
 */
async function isSpentGrant(res: Response): Promise<boolean> {
  try {
    const body = await Promise.race([
      res.json() as Promise<{ error?: unknown } | null>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REFUSAL_BODY_TIMEOUT_MS)),
    ]);
    return body?.error === "invalid_grant";
  } catch {
    return false;
  }
}

async function refreshAccessToken(): Promise<TraktSession | null> {
  const current = getSession();
  if (!current) return null;
  let res: Response;
  try {
    res = await fetch(TRAKT_TOKEN_PROXY, {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({
        refresh_token: current.refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    // A transport failure says nothing about the grant, so the stored session stays.
    return null;
  }
  // A refresh belongs to its captured session, including failed refreshes.
  // Signing in elsewhere while it is pending must not replace that new session.
  if (getSession() !== current) return null;
  if (!res.ok) {
    // Only Trakt saying this refresh token is spent ends the connection. A proxy hiccup,
    // a rate limit, a server error, a Cloudflare challenge or a server-side
    // misconfiguration must not sign the listener out of their tracker and lose the
    // refresh token, which is the only thing that can restore it silently.
    if (
      (res.status === 400 || res.status === 401 || res.status === 403) &&
      (await isSpentGrant(res))
    ) {
      // A refresh token rotates on every use: a rejection means this one is spent.
      const latest = getSession();
      if (latest?.refreshToken === current.refreshToken) setSession(null);
    }
    return null;
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    created_at: number;
    expires_in: number;
  };
  if (getSession() !== current) return null;
  const next: TraktSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    createdAt: data.created_at,
    expiresIn: data.expires_in,
    username: current.username,
  };
  setSession(next);
  return next;
}

let inflightRefresh: Promise<TraktSession | null> | null = null;
function ensureRefreshed(): Promise<TraktSession | null> {
  if (!inflightRefresh) {
    inflightRefresh = refreshAccessToken().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function doFetch(path: string, opts: TraktRequestOptions): Promise<Response> {
  opts.assertCurrent?.();
  const headers: Record<string, string> = { ...(baseHeaders() as Record<string, string>) };
  const useAuth = opts.authed !== false;
  if (useAuth) {
    const session = getSession();
    if (session) headers["Authorization"] = `Bearer ${session.accessToken}`;
  }
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  return fetch(`${TRAKT_API_BASE}${path}`, init);
}

export async function traktRequest<T>(path: string, opts: TraktRequestOptions = {}): Promise<T> {
  let res = await doFetch(path, opts);

  if (res.status === 401 && opts.authed !== false) {
    opts.assertCurrent?.();
    const refreshed = await ensureRefreshed();
    if (refreshed) res = await doFetch(path, opts);
  }

  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "1");
    const waitMs = Math.min(Math.max(retry, 1), 30) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await doFetch(path, opts);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TraktApiError(res.status, body);
  }

  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}
