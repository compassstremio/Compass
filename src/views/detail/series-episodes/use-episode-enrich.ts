import { useEffect, useMemo, useState } from "react";
import { pickPreferredEpisodeOverview, pickPreferredEpisodeTitle } from "@/lib/localized-text";
import {
  PREFERRED_TEXT_SCORE,
  preferredMeta,
  preferredVideoMap,
  preferredVideoName,
  preferredVideoOverview,
  type PreferredVideo,
} from "@/lib/meta-resource";
import { useEpisodeImdbRatings } from "../use-episode-imdb-ratings";
import type { Episode } from "@/lib/providers/tmdb";
import { tmdbLanguageIso } from "@/lib/providers/tmdb/tmdb-client";
import {
  tvdbEpisodes,
  tvdbLangFromIso1,
  tvdbSeriesByImdb,
  type TvdbEpisode,
} from "@/lib/providers/tvdb";

export function useEpisodeEnrich({
  episodes,
  active,
  imdbId,
  tvdbKey,
  omdbKey,
  metaId,
  preferCustomMeta,
  ratings = true,
}: {
  episodes: Episode[];
  active: number;
  imdbId: string | null;
  tvdbKey: string;
  omdbKey: string;
  metaId: string;
  preferCustomMeta: boolean;
  ratings?: boolean;
}): {
  episodes: Episode[];
  imdbRatings: Map<string, number>;
  preferredVideos: Map<string, PreferredVideo>;
} {
  const language = tmdbLanguageIso();
  const seasonKey = `${imdbId || metaId || ""}:${language}:${active}`;
  const [tvdbBySeason, setTvdbBySeason] = useState<Map<string, Map<number, TvdbEpisode>>>(
    new Map(),
  );
  const imdbRatings = useEpisodeImdbRatings(
    ratings ? imdbId : null,
    active,
    ratings ? omdbKey : "",
  );
  const [preferredVideos, setPreferredVideos] = useState<Map<string, PreferredVideo>>(new Map());

  useEffect(() => {
    setPreferredVideos((prev) => (prev.size === 0 ? prev : new Map<string, PreferredVideo>()));
    if (!preferCustomMeta || !metaId) return;
    let cancelled = false;
    void preferredMeta("series", metaId).then((full) => {
      if (cancelled) return;
      const map = preferredVideoMap(full?.videos);
      if (map.size > 0) setPreferredVideos(map);
    });
    return () => {
      cancelled = true;
    };
  }, [metaId, preferCustomMeta]);

  useEffect(() => {
    if (!tvdbKey || !imdbId) return;
    if (tvdbBySeason.has(seasonKey)) return;
    let cancelled = false;
    void (async () => {
      const seriesId = await tvdbSeriesByImdb(tvdbKey, imdbId);
      if (!seriesId || cancelled) return;
      const eps = await tvdbEpisodes(tvdbKey, seriesId, active, tvdbLangFromIso1(language));
      if (cancelled) return;
      const map = new Map<number, TvdbEpisode>();
      for (const e of eps) map.set(e.number, e);
      setTvdbBySeason((prev) => new Map(prev).set(seasonKey, map));
    })();
    return () => {
      cancelled = true;
    };
  }, [imdbId, active, tvdbKey, tvdbBySeason, seasonKey, language]);

  const tvdbForSeason = tvdbBySeason.get(seasonKey);
  const enriched = useMemo<Episode[]>(() => {
    if (!tvdbForSeason && imdbRatings.size === 0 && preferredVideos.size === 0) return episodes;
    return episodes.map((ep): Episode => {
      let next: Episode = ep;
      const tv = tvdbForSeason?.get(ep.episodeNumber);
      const pref = preferredVideos.get(`${ep.seasonNumber}:${ep.episodeNumber}`);
      if (tv || pref) {
        // pickLocalizedText keys script tests by ISO-1 ("ko"), not TVDB codes ("kor").
        const lang = language;
        const name =
          pickPreferredEpisodeTitle(
            [
              { text: preferredVideoName(pref), score: PREFERRED_TEXT_SCORE },
              { text: tv?.name, language: tv?.nameLanguage },
            ],
            [{ text: next.name, language: next.nameLanguage }],
            lang,
          ) ?? next.name;
        const overview =
          pickPreferredEpisodeOverview(
            [
              { text: preferredVideoOverview(pref), score: PREFERRED_TEXT_SCORE },
              { text: tv?.overview, language: tv?.overviewLanguage },
            ],
            [{ text: next.overview, language: next.overviewLanguage }],
            lang,
          ) ?? next.overview;
        next = {
          ...next,
          name,
          overview,
          nameLanguage:
            name === next.name ? next.nameLanguage : name === tv?.name ? tv.nameLanguage : "und",
          overviewLanguage:
            overview === next.overview
              ? next.overviewLanguage
              : overview === tv?.overview
                ? tv.overviewLanguage
                : "und",
          runtime: next.runtime ?? tv?.runtime ?? null,
          airDate: next.airDate ?? tv?.aired ?? null,
        };
      }
      const imdbRating = imdbRatings.get(`${ep.seasonNumber}:${ep.episodeNumber}`);
      if (imdbRating != null && imdbRating > 0) {
        next = { ...next, imdbRating };
      }
      return next;
    });
  }, [episodes, tvdbForSeason, imdbRatings, active, preferredVideos, language]);
  return { episodes: enriched, imdbRatings, preferredVideos };
}
