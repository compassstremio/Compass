import { simklRequest } from "./client";
import { postOauth2 } from "./refresh";
import { setSession } from "./session";
import type { SimklPin, SimklSession } from "./types";

// OAuth 2.0 (V2) device flow. Write access must be requested up front: a refresh can never widen it,
// and an unknown scope string is silently downgraded to read-only.
const SIMKL_SCOPE = "media:read media:write";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SLOW_DOWN_EXTRA_SEC = 5;

export async function requestPin(): Promise<SimklPin> {
  const { status, json } = await postOauth2("/oauth2/device", { scope: SIMKL_SCOPE });
  const deviceCode = typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  if (status !== 200 || !deviceCode || !userCode) {
    throw new Error(`Simkl refused the sign-in request (${json.error ?? `HTTP ${status}`}).`);
  }
  const verificationUrl =
    typeof json.verification_uri === "string" ? json.verification_uri : "https://simkl.com/pin";
  const deepLinkUrl =
    typeof json.verification_uri_complete === "string"
      ? json.verification_uri_complete
      : `${verificationUrl}?user_code=${encodeURIComponent(userCode)}`;
  return {
    deviceCode,
    userCode,
    verificationUrl,
    deepLinkUrl,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 900,
    pollIntervalSec: typeof json.interval === "number" ? json.interval : 5,
  };
}

export type PollResult =
  | { kind: "authorized"; session: SimklSession }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export type PollHandle = { cancel: () => void };

type PollStep =
  | { kind: "pending" }
  | { kind: "slow" }
  | PollResult;

async function pollOnce(deviceCode: string): Promise<PollStep> {
  let status: number;
  let json: Awaited<ReturnType<typeof postOauth2>>["json"];
  try {
    ({ status, json } = await postOauth2("/oauth2/token", {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
    }));
  } catch {
    return { kind: "pending" };
  }
  if (status === 200 && json.access_token) {
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 604800;
    return {
      kind: "authorized",
      session: {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + expiresIn * 1000,
        username: null,
      },
    };
  }
  switch (json.error) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow" };
    case "expired_token":
      return { kind: "expired" };
    default:
      return { kind: "error", message: `Simkl sign-in failed (${json.error ?? `HTTP ${status}`}).` };
  }
}

export function pollForToken(pin: SimklPin, onUpdate: (result: PollResult) => void): PollHandle {
  let cancelled = false;
  const startedAt = Date.now();
  (async () => {
    let intervalSec = pin.pollIntervalSec;
    while (!cancelled) {
      if ((Date.now() - startedAt) / 1000 >= pin.expiresIn) {
        if (!cancelled) onUpdate({ kind: "expired" });
        return;
      }
      await new Promise((r) => setTimeout(r, intervalSec * 1000));
      if (cancelled) return;
      const step = await pollOnce(pin.deviceCode);
      if (cancelled) return;
      if (step.kind === "slow") {
        intervalSec += SLOW_DOWN_EXTRA_SEC;
      } else if (step.kind !== "pending") {
        onUpdate(step);
        return;
      }
    }
  })();
  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

export async function fetchUsername(session: SimklSession): Promise<string | null> {
  try {
    interface SettingsResponse {
      user?: {
        name?: string;
      };
    }
    const data = await simklRequest<SettingsResponse>("/users/settings", {
      method: "POST",
      token: session.accessToken,
    });
    return data.user?.name ?? null;
  } catch {
    return null;
  }
}

export async function completeAuthorization(session: SimklSession): Promise<SimklSession> {
  const username = await fetchUsername(session).catch(() => null);
  const final: SimklSession = { ...session, username };
  setSession(final);
  return final;
}
