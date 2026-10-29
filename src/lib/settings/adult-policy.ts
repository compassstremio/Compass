import type { Settings } from "./types";

export function enforceAdultPolicy<T extends Partial<Settings>>(patch: T): T {
  const out: T = { ...patch };
  if (out.hideContent) out.hideContent = { ...out.hideContent, adult: true };
  if ("showAdultAddons" in out) out.showAdultAddons = false;
  return out;
}
