import type { GameSummary } from "./types";

export type PlayniteStore = "steam" | "epic" | "gog" | "ea" | "ubisoft" | "battlenet" | "itch" | "xbox" | "amazon";
export type PlayniteGame = {
  id: string; name: string; source: string; store?: PlayniteStore; steamAppId?: number;
  installed: boolean; installPath?: string; platforms: string[];
  /** Seconds, as Playnite measured them. */
  playtime: number; lastPlayed: number; addedAt: number;
  hidden: boolean; favorite: boolean;
  /** An absolute Playnite library file or a public HTTPS image. */
  cover?: string; background?: string; icon?: string;
};
export type PlayniteStatus = {
  supported: boolean; found: boolean; dataDir?: string;
  extension?: "missing" | "outdated" | "installed";
  exportedAt: number; games: PlayniteGame[]; error?: string;
};
export const emptyPlayniteStatus = (): PlayniteStatus => ({ supported: false, found: false, exportedAt: 0, games: [] });
export const PLAYNITE_FOLDER_KEY = "compass.games.playnite.folder";

/** Playnite keeps its own entry identity. A Steam app ID only borrows catalog details and art. */
export function playniteSummary(game: PlayniteGame, image: (path: string) => string = path => path): GameSummary {
  const art = (value?: string) => value ? (value.startsWith("https://") ? value : image(value)) : undefined;
  const portrait = art(game.cover), capsule = art(game.background) ?? portrait ?? "";
  return { id: `playnite:${game.id}`, name: game.name, capsule, platforms: game.platforms,
    ...(portrait ? { portrait } : {}), ...(game.steamAppId ? { steamId: game.steamAppId } : {}) };
}

const normalized = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Compass already reads Steam and the store launchers directly; their native entries stay the
 * source of truth. Playnite fills in only what those scans could not see.
 */
export function playniteAdditions(games: PlayniteGame[], known: { steamIds: Set<number>; launcherNames: Map<string, Set<string>> }) {
  return games.filter(game => {
    if (game.steamAppId && known.steamIds.has(game.steamAppId)) return false;
    return !(game.store && known.launcherNames.get(game.store)?.has(normalized(game.name)));
  });
}
export function launcherNameIndex(entries: { launcher: string; name: string }[]) {
  const index = new Map<string, Set<string>>();
  for (const entry of entries) {
    const names = index.get(entry.launcher) ?? new Set<string>();
    names.add(normalized(entry.name)); index.set(entry.launcher, names);
  }
  return index;
}
