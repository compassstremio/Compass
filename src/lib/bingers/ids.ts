import type { PlayEpisode } from "@/lib/view";
import type { BingersTarget } from "./types";

export type BingersEpisodeRef = Pick<
  PlayEpisode,
  "season" | "episode" | "imdbId" | "imdbSeason" | "imdbEpisode" | "tvdbEpisodeId"
>;

export type BingersTargetInput = {
  metaId: string;
  metaType?: string;
  episode?: BingersEpisodeRef;
  /** IMDb id the player resolved for a meta whose own id is not one. */
  imdbId?: string;
};

const IMDB = /^tt\d{1,10}$/;
const NUMERIC = /^\d{1,10}$/;
const ANIME_PREFIXES = new Set(["kitsu", "mal", "anilist"]);

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function episodeOf(title: string, season: unknown, episode: unknown): BingersTarget | null {
  if (!isCount(season, 1000) || !isCount(episode, 10000)) return null;
  return { title, season, episode };
}

function numberAt(parts: string[], i: number): number | undefined {
  const raw = parts[i];
  return raw != null && NUMERIC.test(raw) ? Number(raw) : undefined;
}

// A series with no episode would name the whole show, which Bingers marks watched in
// full. Playback is always one item, so that case resolves to nothing.
function showEpisode(
  title: string,
  parts: string[],
  seasonAt: number,
  episode: BingersEpisodeRef | undefined,
): BingersTarget | null {
  const season = numberAt(parts, seasonAt);
  const number = numberAt(parts, seasonAt + 1);
  if (season != null && number != null) return episodeOf(title, season, number);
  return episode ? episodeOf(title, episode.season, episode.episode) : null;
}

function fromImdb(input: BingersTargetInput, parts: string[]): BingersTarget | null {
  const title = `imdb:${parts[0]}`;
  if (parts.length >= 3 || input.episode) return showEpisode(title, parts, 1, input.episode);
  return input.metaType === "series" ? null : { title };
}

function fromTmdb(input: BingersTargetInput, parts: string[]): BingersTarget | null {
  const kind = NUMERIC.test(parts[1] ?? "") ? null : parts[1];
  const idAt = kind ? 2 : 1;
  const id = parts[idAt];
  if (!id || !NUMERIC.test(id)) return null;
  const isMovie = kind ? kind === "movie" : input.metaType !== "series" && !input.episode;
  if (isMovie) return { title: `tmdb:movie:${id}` };
  if (kind && kind !== "tv" && kind !== "series" && kind !== "show") return null;
  return showEpisode(`tmdb:show:${id}`, parts, idAt + 1, input.episode);
}

function fromTvdb(input: BingersTargetInput, parts: string[]): BingersTarget | null {
  const id = parts[1];
  if (!id || !NUMERIC.test(id)) return null;
  if (parts.length >= 4 || input.episode) return showEpisode(`tvdb:${id}`, parts, 2, input.episode);
  return input.metaType === "movie" ? { title: `tvdb:${id}` } : null;
}

/** Ids Bingers cannot read itself: borrow the TVDB episode or the IMDb mapping. */
function fromMapping(input: BingersTargetInput, anime: boolean): BingersTarget | null {
  const { episode } = input;
  const imdb = [episode?.imdbId, input.imdbId].find((id) => !!id && IMDB.test(id));
  if (!episode) return imdb && input.metaType === "movie" ? { title: `imdb:${imdb}` } : null;
  if (episode.tvdbEpisodeId != null && episode.tvdbEpisodeId > 0) {
    return { tvdb_episode: String(episode.tvdbEpisodeId) };
  }
  if (!imdb) return null;
  // Anime numbering (absolute, per-cour) rarely matches the show's own seasons, so
  // only IMDb's explicit mapping is trusted there.
  if (anime) return episodeOf(`imdb:${imdb}`, episode.imdbSeason, episode.imdbEpisode);
  return episodeOf(
    `imdb:${imdb}`,
    episode.imdbSeason ?? episode.season,
    episode.imdbEpisode ?? episode.episode,
  );
}

export function resolveBingersTarget(input: BingersTargetInput): BingersTarget | null {
  const metaId = input.metaId?.trim();
  if (!metaId) return null;
  const parts = metaId.split(":");
  const head = parts[0].toLowerCase();
  if (IMDB.test(parts[0])) return fromImdb(input, parts);
  if (head === "tmdb") return fromTmdb(input, parts);
  if (head === "tvdb") return fromTvdb(input, parts);
  return fromMapping(input, ANIME_PREFIXES.has(head));
}
