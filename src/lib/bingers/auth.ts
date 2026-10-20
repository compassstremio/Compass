import { safeFetch } from "@/lib/safe-fetch";
import {
  BINGERS_CLIENT_ID,
  BINGERS_DEVICE_CODE_URL,
  BINGERS_REFRESH_LEEWAY_MS,
  BINGERS_RESOURCE,
  BINGERS_SCOPE,
  BINGERS_TOKEN_URL,
} from "./config";
import { getSession, setSession } from "./session";
import {
  classifyRefresh,
  classifyTokenPoll,
  errorMessage,
  parseDeviceCode,
  type PollResult,
} from "./tokens";
import type { BingersSession, DeviceCode } from "./types";

async function postForm(
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

export async function requestDeviceCode(): Promise<DeviceCode> {
  const { status, data } = await postForm(BINGERS_DEVICE_CODE_URL, {
    client_id: BINGERS_CLIENT_ID,
    scope: BINGERS_SCOPE,
    resource: BINGERS_RESOURCE,
  });
  const device = status >= 200 && status < 300 ? parseDeviceCode(data) : null;
  if (!device) throw new Error(`Bingers device-code request failed: ${errorMessage(data, status)}`);
  return device;
}

async function pollOnce(deviceCode: string): Promise<PollResult> {
  const { status, data } = await postForm(BINGERS_TOKEN_URL, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: BINGERS_CLIENT_ID,
  });
  return classifyTokenPoll(status, data, Date.now());
}

export type PollHandle = { cancel: () => void };

export function pollForToken(
  device: DeviceCode,
  onUpdate: (result: PollResult) => void,
): PollHandle {
  let cancelled = false;
  let intervalSec = device.pollIntervalSec;
  const startedAt = Date.now();

  void (async () => {
    while (!cancelled) {
      await new Promise((r) => setTimeout(r, intervalSec * 1000));
      if (cancelled) return;
      if ((Date.now() - startedAt) / 1000 >= device.expiresIn) {
        onUpdate({ kind: "expired" });
        return;
      }
      const result = await pollOnce(device.deviceCode).catch(
        (e: unknown): PollResult => ({
          kind: "error",
          message: e instanceof Error ? e.message : "Network error",
        }),
      );
      if (cancelled) return;
      if (result.kind === "pending") continue;
      if (result.kind === "slow_down") {
        // RFC 8628: every slow_down adds five seconds to the interval for good.
        intervalSec += 5;
        continue;
      }
      onUpdate(result);
      return;
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

let refreshing: Promise<BingersSession | null> | null = null;

/** Single-flight: every caller that finds the token stale shares one refresh. */
export function refreshSession(): Promise<BingersSession | null> {
  if (refreshing) return refreshing;
  const before = getSession();
  const refreshToken = before?.refreshToken;
  if (!before || !refreshToken) return Promise.resolve(null);
  refreshing = (async () => {
    try {
      const { status, data } = await postForm(BINGERS_TOKEN_URL, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: BINGERS_CLIENT_ID,
        resource: BINGERS_RESOURCE,
      });
      // The user disconnected or reconnected while this ran; keep what they chose. A
      // rename meanwhile is the same grant, and dropping a rotated token would end it.
      const current = getSession();
      if (!current || current.connectedAt !== before.connectedAt) return current;
      const result = classifyRefresh(status, data, Date.now(), current);
      if (result.kind === "ok") {
        setSession(result.session);
        return result.session;
      }
      if (result.kind === "revoked") setSession(null);
      return null;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function freshAccessToken(): Promise<string | null> {
  const session = getSession();
  if (!session) return null;
  if (Date.now() < session.expiresAt - BINGERS_REFRESH_LEEWAY_MS) return session.accessToken;
  if (!session.refreshToken && Date.now() >= session.expiresAt) {
    // A grant without offline_access cannot outlive its hour; show it as signed out.
    setSession(null);
    return null;
  }
  const refreshed = await refreshSession();
  // Offline refreshes fail without revoking anything; let the API judge the old token.
  return refreshed?.accessToken ?? getSession()?.accessToken ?? null;
}
