import { APP_VERSION } from "@/lib/build-info";
import { COMPASS_API_BASE } from "@/lib/config/endpoints";

export const SIMKL_API_BASE = "https://api.simkl.com";
export const SIMKL_CLIENT_ID =
  (import.meta.env.VITE_SIMKL_CLIENT_ID as string | undefined) ||
  "79f420285b65373328065b5ce9db2ea74326f7fd2d675e45fb6984ea06b40b86";
export const SIMKL_VERIFY_URL = "https://simkl.com/pin";
export const WATCHED_RATIO = 0.85;
export const SIMKL_WATCHED_RATIO = 0.9;
export const SIMKL_APP_NAME = "compass";
export const SIMKL_APP_VERSION = APP_VERSION;
export const SIMKL_USER_AGENT = `Compass/${APP_VERSION} (+${COMPASS_API_BASE})`;
