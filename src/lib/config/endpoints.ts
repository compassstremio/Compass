function resolveBase(raw: string | undefined, fallback: string): string {
  const value = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  return value.replace(/\/+$/, "");
}

export const COMPASS_API_BASE = resolveBase(
  import.meta.env.VITE_COMPASS_API_BASE,
  "https://compass.sarl",
);

export const COMPASS_TRAKT_BASE = resolveBase(
  import.meta.env.VITE_COMPASS_TRAKT_BASE,
  COMPASS_API_BASE,
);

export const COMPASS_MAL_BASE = resolveBase(import.meta.env.VITE_COMPASS_MAL_BASE, COMPASS_API_BASE);

export const COMPASS_TVDB_BASE = resolveBase(import.meta.env.VITE_COMPASS_TVDB_BASE, COMPASS_API_BASE);

export const COMPASS_BUGS_BASE = resolveBase(
  import.meta.env.VITE_COMPASS_BUGS_BASE,
  "https://bugs.compass.sarl",
);

export const COMPASS_SYNC_BASE = resolveBase(
  import.meta.env.VITE_COMPASS_SYNC_BASE,
  "https://sync.compass.sarl",
);

export const COMPASS_RELAY_BASE = resolveBase(
  import.meta.env.VITE_COMPASS_RELAY_BASE,
  "https://app.compass.sarl",
);

export const COMPASS_DISCORD_INVITE = resolveBase(
  import.meta.env.VITE_COMPASS_DISCORD_INVITE,
  "https://discord.gg/pQBRmN9XdD",
);
