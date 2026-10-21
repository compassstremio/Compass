import type { SimklSession } from "./types";

// Refresh a little before the 7-day access token actually dies.
export const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** True for OAuth 2.0 sessions whose access token is expired or about to be. Legacy PIN sessions never refresh. */
export function sessionNeedsRefresh(session: SimklSession | null, now = Date.now()): boolean {
  if (!session?.refreshToken || typeof session.expiresAt !== "number") return false;
  return session.expiresAt - now <= REFRESH_MARGIN_MS;
}
