import { COMPASS_TRAKT_BASE } from "@/lib/config/endpoints";

export const TRAKT_API_BASE = "https://api.trakt.tv";
export const TRAKT_API_VERSION = "2";
export const TRAKT_CLIENT_ID = "4bFJtc270W3E8XA4mL3a_WwDNc6yWypQhPR21vks9AM";
export const TRAKT_TOKEN_PROXY = `${COMPASS_TRAKT_BASE}/api/trakt/token`;
export const TRAKT_DEVICE_TOKEN_PROXY = `${COMPASS_TRAKT_BASE}/api/trakt/device-token`;
export const TRAKT_VERIFY_URL = "https://trakt.tv/activate";
export const REFRESH_THRESHOLD_SEC = 14 * 24 * 60 * 60;
export const WRITE_MIN_INTERVAL_MS = 1000;
