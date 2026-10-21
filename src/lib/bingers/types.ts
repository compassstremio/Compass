export type BingersSession = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms when the access token stops working. */
  expiresAt: number;
  scope: string;
  name: string | null;
  handle: string | null;
  /** Epoch ms of the device authorization. */
  connectedAt: number;
};

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string | null;
  expiresIn: number;
  pollIntervalSec: number;
};

/** One scrobble item, already in the shape `POST /v1/scrobble` takes. */
export type BingersTarget = {
  title?: string;
  season?: number;
  episode?: number;
  tvdb_episode?: string;
};

/**
 * `ok`: the API answers. `plan-required`: the account has no Legend or Icon plan, so
 * every call is refused. `reauth`: the grant lacks `library:write`.
 */
export type BingersAccess = "unknown" | "ok" | "plan-required" | "reauth";

export type ScrobbleOutcome = "recorded" | "unresolved" | "refused" | "failed";
