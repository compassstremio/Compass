import { MAL_AUTHORIZE_URL, MAL_CLIENT_ID, MAL_TOKEN_PROXY } from "./config";
import { getSession, setSession } from "./session";
import type { MalSession } from "./types";
import { activeProfileId } from "@/lib/active-profile-id";

function generateVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  let result = "";
  for (let i = 0; i < 64; i++) result += chars[array[i] % chars.length];
  return result;
}

type PendingAuthorization = { verifier: string; state: string; profileId: string; createdAt: number };
const PENDING_KEY = "compass.mal.authorization.v1";
let pendingAuthorization: PendingAuthorization | null = null;

export function cancelAuthorization(): void {
  pendingAuthorization = null;
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
}

function getPendingAuthorization(): PendingAuthorization | null {
  try {
    pendingAuthorization ??= JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
  } catch {}
  const pending = pendingAuthorization;
  if (!pending || typeof pending.verifier !== "string" || typeof pending.state !== "string" ||
    pending.profileId !== activeProfileId() || !Number.isFinite(pending.createdAt) ||
    Date.now() - pending.createdAt > 15 * 60 * 1000) return null;
  return pending;
}

export function buildAuthorizeUrl(): string {
  const verifier = generateVerifier();
  const state = generateVerifier();
  pendingAuthorization = { verifier, state, profileId: activeProfileId(), createdAt: Date.now() };
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingAuthorization)); } catch {}

  const params = new URLSearchParams({
    response_type: "code",
    client_id: MAL_CLIENT_ID,
    code_challenge: verifier,
    code_challenge_method: "plain",
    state,
  });
  return `${MAL_AUTHORIZE_URL}?${params.toString()}`;
}

export function extractMalCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const fromUrl = /[?&#]code=([^&\s#]+)/.exec(trimmed);
  if (fromUrl) {
    try {
      return decodeURIComponent(fromUrl[1]).trim();
    } catch {
      return fromUrl[1].trim();
    }
  }
  return trimmed.replace(/^["'\s]+|["'\s]+$/g, "");
}

async function tauriFetch(input: string, init?: RequestInit): Promise<Response> {
  if ("__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetchFn } = await import("@tauri-apps/plugin-http");
    return tauriFetchFn(input, init as Record<string, unknown>) as unknown as Response;
  }
  return fetch(input, init);
}

export async function completeAuthorization(pastedCode: string, requireState = false): Promise<MalSession> {
  const code = extractMalCode(pastedCode);
  if (!code) throw new Error("Paste the code from MyAnimeList to continue");
  const pending = getPendingAuthorization();
  if (!pending) throw new Error("Session expired. Start over and authorize again.");
  if (requireState) {
    const params = new URL(pastedCode).searchParams;
    if (params.get("state") !== pending.state) throw new Error("This authorization belongs to another attempt. Authorize again.");
  }
  const tokenData = await exchangeCode(code, pending.verifier);

  const userName = await fetchUserName(tokenData.access_token);
  if (getPendingAuthorization() !== pending) throw new Error("Authorization was cancelled. Start over and authorize again.");
  cancelAuthorization();

  const now = Date.now();
  const session: MalSession = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    createdAt: now,
    expiresAt: now + tokenData.expires_in * 1000,
    userName,
  };
  setSession(session);
  return session;
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await tauriFetch(MAL_TOKEN_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MAL rejected that code (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("MAL did not return a token. Try authorizing again.");
  return json;
}

export async function refreshAccessToken(): Promise<MalSession | null> {
  const current = getSession();
  if (!current?.refreshToken) return null;
  try {
    const res = await tauriFetch(MAL_TOKEN_PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
    });
    if (!res.ok) {
      setSession(null);
      return null;
    }
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const now = Date.now();
    const next: MalSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      createdAt: now,
      expiresAt: now + data.expires_in * 1000,
      userName: current.userName,
    };
    setSession(next);
    return next;
  } catch {
    if (!navigator.onLine) return null;
    setSession(null);
    return null;
  }
}

let inflightRefresh: Promise<MalSession | null> | null = null;

export function ensureRefreshed(): Promise<MalSession | null> {
  if (!inflightRefresh) {
    inflightRefresh = refreshAccessToken().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function fetchUserName(accessToken: string): Promise<string> {
  const res = await tauriFetch("https://api.myanimelist.net/v2/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "unknown";
  const json = await res.json();
  return json.name ?? "unknown";
}
