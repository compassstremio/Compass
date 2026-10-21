export const BINGERS_API_BASE = "https://api.bingers.app/v1";
export const BINGERS_AUTH_BASE = "https://api.bingers.app/auth";
export const BINGERS_DEVICE_CODE_URL = `${BINGERS_AUTH_BASE}/device/code`;
export const BINGERS_TOKEN_URL = `${BINGERS_AUTH_BASE}/oauth2/token`;
// Bingers has no app registration: the client id is the URL of a metadata document we
// host, and it must match that document's own client_id field byte for byte.
export const BINGERS_CLIENT_ID = "https://compass.sarl/bingers-client.json";
export const BINGERS_SCOPE = "library:read library:write offline_access profile";
// Tokens are audience-bound; one issued for the MCP server does not work on /v1.
export const BINGERS_RESOURCE = BINGERS_API_BASE;
export const BINGERS_VERIFY_URL = "https://bingers.app/activate";
export const BINGERS_INTEGRATIONS_URL = "https://bingers.app/integrations";
export const BINGERS_WEBSITE = "https://bingers.app";
/** Refresh this long before the hour-long access token runs out. */
export const BINGERS_REFRESH_LEEWAY_MS = 2 * 60 * 1000;
/** The API takes at most 100 items per write. */
export const BINGERS_MAX_BATCH = 100;
