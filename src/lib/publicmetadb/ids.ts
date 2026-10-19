import {
  aniZipByAnidb,
  aniZipByAnilist,
  aniZipByImdb,
  aniZipByKitsu,
  aniZipByMal,
} from "@/lib/providers/anizip";
import { anidbToMal, anilistToMal, kitsuToMal } from "@/lib/providers/anime-mapping";
import { get } from "@/lib/providers/tmdb/tmdb-client";
import type { PmdbTarget } from "./types";

export type EpisodeIdentity = {
  season: number;
  episode: number;
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteNumber?: number;
};

/**
 * Known TMDb anime series where all broadcast episodes are cataloged under
 * Season 1 with continuous absolute numbering, while TVDB/Compass divides them
 * into multiple seasons.
 */
export const KNOWN_TMDB_SINGLE_SEASON_ANIME = new Set<number>([
  65942, // Re:ZERO -Starting Life in Another World- (85 episodes in S1 on TMDb, 4 seasons in TVDB/Compass)
  37854, // One Piece (1100+ episodes in S1 on TMDb, 21+ seasons in TVDB/Compass)
  46260, // Naruto (220 episodes in S1 on TMDb, 5 seasons in TVDB/Compass)
  31910, // Naruto Shippuden (500 episodes in S1 on TMDb, 21 seasons in TVDB/Compass)
  30984, // Bleach (366 episodes in S1 on TMDb, 16 seasons in TVDB/Compass)
  73223, // Black Clover (170 episodes in S1 on TMDb, 4 seasons in TVDB/Compass)
  12971, // Dragon Ball Z (291 episodes in S1 on TMDb, 9 seasons in TVDB/Compass)
  12609, // Dragon Ball (153 episodes in S1 on TMDb, 9 seasons in TVDB/Compass)
  46298, // Hunter x Hunter (2011) (148 episodes in S1 on TMDb, 6 seasons in TVDB/Compass)
  57243, // Gintama (201 episodes in S1 on TMDb, 8 seasons in TVDB/Compass)
  46261, // Fairy Tail (175 episodes in S1 on TMDb, 9 seasons in TVDB/Compass)
  2362,  // Detective Conan (1000+ episodes in S1 on TMDb)
  70881, // Boruto: Naruto Next Generations (293 episodes in S1 on TMDb, 6 seasons in TVDB/Compass)
  1434,  // Yu-Gi-Oh! (224 episodes in S1 on TMDb, 5 seasons in TVDB/Compass)
  46262, // Inuyasha (167 episodes in S1 on TMDb, 7 seasons in TVDB/Compass)
  1433,  // Sailor Moon (200 episodes in S1 on TMDb, 5 seasons in TVDB/Compass)
  45790, // JoJo's Bizarre Adventure (152 episodes in S1 on TMDb, 5 seasons in TVDB/Compass)
  60572, // Haikyu!! (85 episodes in S1 on TMDb, 4 seasons in TVDB/Compass)
  67075, // Food Wars! Shokugeki no Soma (86 episodes in S1 on TMDb, 5 seasons in TVDB/Compass)
]);

const singleSeasonCache = new Map<number, boolean>();
const SINGLE_SEASON_CACHE_MAX = 200;

function cacheSingleSeason(tmdbId: number, value: boolean): void {
  if (singleSeasonCache.size >= SINGLE_SEASON_CACHE_MAX) {
    const oldest = singleSeasonCache.keys().next();
    if (!oldest.done) singleSeasonCache.delete(oldest.value);
  }
  singleSeasonCache.set(tmdbId, value);
}

function getStoredTmdbKey(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem("compass.settings");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return typeof parsed?.tmdbKey === "string" && parsed.tmdbKey ? parsed.tmdbKey : undefined;
  } catch {
    return undefined;
  }
}

export async function isTmdbSingleSeasonShow(tmdbId: number, tmdbKey?: string): Promise<boolean> {
  if (KNOWN_TMDB_SINGLE_SEASON_ANIME.has(tmdbId)) return true;
  if (singleSeasonCache.has(tmdbId)) return singleSeasonCache.get(tmdbId)!;

  const key = tmdbKey || getStoredTmdbKey();
  if (!key) return false;

  try {
    const raw = await get<any>(key, `tv/${tmdbId}`);
    const seasons = raw?.seasons;
    if (Array.isArray(seasons)) {
      const regularSeasons = seasons.filter(
        (s: { season_number?: number; episode_count?: number }) =>
          typeof s.season_number === "number" &&
          s.season_number > 0 &&
          typeof s.episode_count === "number" &&
          s.episode_count > 0,
      );
      const isSingle = regularSeasons.length === 1 && regularSeasons[0].season_number === 1;
      cacheSingleSeason(tmdbId, isSingle);
      return isSingle;
    }
  } catch {
    // Ignore network/API failures
  }

  return false;
}

async function animeIdToMal(compassId: string): Promise<number | null> {
  const n = Number(compassId.split(":")[1]);
  if (!Number.isFinite(n)) return null;
  if (compassId.startsWith("mal:")) return n;
  if (compassId.startsWith("kitsu:")) return kitsuToMal(n).catch(() => null);
  if (compassId.startsWith("anilist:")) return anilistToMal(n).catch(() => null);
  if (compassId.startsWith("anidb:")) return anidbToMal(n).catch(() => null);
  return null;
}

async function animeAniZip(compassId: string, fallbackImdb?: string) {
  const match = /^(kitsu|mal|anilist|anidb):(\d+)/.exec(compassId);
  if (match) {
    const kind = match[1];
    const id = Number(match[2]);
    if (Number.isFinite(id)) {
      if (kind === "kitsu") return aniZipByKitsu(id).catch(() => null);
      if (kind === "mal") return aniZipByMal(id).catch(() => null);
      if (kind === "anilist") return aniZipByAnilist(id).catch(() => null);
      if (kind === "anidb") return aniZipByAnidb(id).catch(() => null);
    }
  }
  if (compassId.startsWith("tt") && /^tt\d+$/.test(compassId)) {
    return aniZipByImdb(compassId).catch(() => null);
  }
  if (fallbackImdb && /^tt\d+$/.test(fallbackImdb)) {
    return aniZipByImdb(fallbackImdb).catch(() => null);
  }
  return null;
}

export function stremioIdToPmdbTarget(
  metaId: string,
  episode?: { season: number; episode: number },
  type?: "movie" | "series" | "tv" | string,
): PmdbTarget | null {
  if (!metaId) return null;

  // TMDB ID format: tmdb:movie:123 or tmdb:tv:123 or tmdb:tv:123:1:2
  if (metaId.startsWith("tmdb:")) {
    const parts = metaId.split(":");
    const kind = parts[1];
    const id = Number(parts[2]);
    if (!Number.isFinite(id)) return null;

    if (kind === "movie") {
      return { tmdb_id: id, media_type: "movie" };
    }
    if (kind === "tv") {
      if (parts.length >= 5) {
        const season = Number(parts[3]);
        const ep = Number(parts[4]);
        if (Number.isFinite(season) && Number.isFinite(ep)) {
          return { tmdb_id: id, media_type: "tv", season, episode: ep };
        }
      }
      if (episode) {
        return {
          tmdb_id: id,
          media_type: "tv",
          season: episode.season,
          episode: episode.episode,
        };
      }
      return { tmdb_id: id, media_type: "tv" };
    }
  }

  // IMDb ID format: tt1234567 or tt1234567:1:2
  if (metaId.startsWith("tt")) {
    const parts = metaId.split(":");
    const imdb = parts[0];
    if (!/^tt\d+$/.test(imdb)) return null;

    if (parts.length >= 3) {
      const season = Number(parts[1]);
      const ep = Number(parts[2]);
      if (Number.isFinite(season) && Number.isFinite(ep)) {
        return {
          id_type: "imdb",
          id_value: imdb,
          media_type: "tv",
          season,
          episode: ep,
        };
      }
    }

    if (episode) {
      return {
        id_type: "imdb",
        id_value: imdb,
        media_type: "tv",
        season: episode.season,
        episode: episode.episode,
      };
    }

    return {
      id_type: "imdb",
      id_value: imdb,
      media_type: type === "series" ? "tv" : "movie",
    };
  }

  // MAL format: mal:123
  if (metaId.startsWith("mal:")) {
    const id = metaId.split(":")[1];
    if (!id) return null;
    return {
      id_type: "mal",
      id_value: id,
      media_type: type === "movie" ? "movie" : "tv",
      ...(episode ? { season: episode.season, episode: episode.episode } : {}),
    };
  }

  // AniList format: anilist:123
  if (metaId.startsWith("anilist:")) {
    const id = metaId.split(":")[1];
    if (!id) return null;
    return {
      id_type: "anilist",
      id_value: id,
      media_type: type === "movie" ? "movie" : "tv",
      ...(episode ? { season: episode.season, episode: episode.episode } : {}),
    };
  }

  return null;
}

export async function resolvePmdbEpisodeTarget(
  compassId: string,
  episode: EpisodeIdentity,
  fallbackImdb?: string,
): Promise<PmdbTarget | null> {
  const isAnime = /^(kitsu|mal|anilist|anidb):/.test(compassId);
  const hasAbsNumber =
    episode.absoluteNumber != null &&
    Number.isFinite(episode.absoluteNumber) &&
    episode.absoluteNumber > 0;

  if (!isAnime && !hasAbsNumber) {
    const direct = stremioIdToPmdbTarget(compassId, {
      season: episode.imdbSeason ?? episode.season,
      episode: episode.imdbEpisode ?? episode.episode,
    }, "series");
    if (direct && (direct.season != null || direct.episode != null)) {
      return direct;
    }
  }

  const az = await animeAniZip(compassId, fallbackImdb);
  const tmdbId = az?.mappings?.themoviedb_id
    ? Number(az.mappings.themoviedb_id)
    : compassId.startsWith("tmdb:tv:")
      ? Number(compassId.split(":")[2])
      : undefined;
  const imdbId = az?.mappings?.imdb_id ||
    (/^tt\d+$/.test(compassId) ? compassId : undefined) ||
    (fallbackImdb && /^tt\d+$/.test(fallbackImdb) ? fallbackImdb : undefined);

  // Anime entry lookups use cour-relative numbers. A whole-show lookup must
  // match season too, or S2E1 would pick the mapping for S1E1.
  const epData = isAnime
    ? az?.episodes?.[String(episode.episode)]
    : Object.values(az?.episodes ?? {}).find((ep) =>
        ep.seasonNumber === (episode.imdbSeason ?? episode.season) &&
        ep.episodeNumber === (episode.imdbEpisode ?? episode.episode),
      );

  let season = episode.imdbSeason ?? epData?.seasonNumber ?? episode.season;
  let number = episode.imdbEpisode ?? epData?.episodeNumber ?? episode.episode;
  const absNum = episode.absoluteNumber ?? epData?.absoluteEpisodeNumber;

  if (tmdbId != null && Number.isFinite(tmdbId)) {
    if (absNum != null && Number.isFinite(absNum) && absNum > 0) {
      const isSingle = await isTmdbSingleSeasonShow(tmdbId);
      if (isSingle) {
        season = 1;
        number = absNum;
      }
    }

    return {
      tmdb_id: tmdbId,
      media_type: "tv",
      season,
      episode: number,
      ...(imdbId ? { id_type: "imdb", id_value: imdbId } : {}),
    };
  }

  if (imdbId) {
    return {
      id_type: "imdb",
      id_value: imdbId,
      media_type: "tv",
      season,
      episode: number,
    };
  }

  const direct = stremioIdToPmdbTarget(compassId, episode, "series");
  if (direct && (direct.season != null || direct.episode != null)) {
    return direct;
  }

  const mal = await animeIdToMal(compassId);
  if (mal != null) {
    return {
      id_type: "mal",
      id_value: String(mal),
      media_type: "tv",
      season,
      episode: number,
    };
  }
  return direct;
}

export async function resolvePmdbTarget(
  compassId: string,
  type?: "movie" | "series" | "tv" | string,
): Promise<PmdbTarget | null> {
  const isAnime = /^(kitsu|mal|anilist|anidb):/.test(compassId);
  if (!isAnime) {
    const direct = stremioIdToPmdbTarget(compassId, undefined, type);
    if (direct) return direct;
  }

  const az = await animeAniZip(compassId);
  const tmdbId = az?.mappings?.themoviedb_id ? Number(az.mappings.themoviedb_id) : undefined;
  const imdbId = az?.mappings?.imdb_id;
  const azType =
    (az?.mappings as { type?: string } | undefined)?.type ??
    (az as { type?: string } | undefined)?.type;
  const mediaType: "movie" | "tv" =
    type === "movie" || azType?.toUpperCase() === "MOVIE" ? "movie" : "tv";

  if (tmdbId != null && Number.isFinite(tmdbId)) {
    return {
      tmdb_id: tmdbId,
      media_type: mediaType,
      ...(imdbId ? { id_type: "imdb", id_value: imdbId } : {}),
    };
  }

  if (imdbId) {
    return {
      id_type: "imdb",
      id_value: imdbId,
      media_type: mediaType,
    };
  }

  const direct = stremioIdToPmdbTarget(compassId, undefined, type);
  if (direct) return direct;

  const mal = await animeIdToMal(compassId);
  if (mal != null) {
    return {
      id_type: "mal",
      id_value: String(mal),
      media_type: type === "movie" ? "movie" : "tv",
    };
  }
  return null;
}
