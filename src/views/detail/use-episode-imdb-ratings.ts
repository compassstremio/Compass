import { useEffect, useMemo, useState } from "react";
import { compassImdbEpisodes } from "@/lib/providers/compass-imdb";
import { omdbSeasonRatings } from "@/lib/providers/omdb";

export function useEpisodeImdbRatings(imdbId: string | null, season: number, omdbKey: string) {
  const key = JSON.stringify([imdbId, season, omdbKey]);
  const [result, setResult] = useState({
    key: "",
    compass: new Map<string, number>(),
    omdb: new Map<string, number>(),
  });
  useEffect(() => {
    let cancelled = false;
    // The two sources answer in whatever order the network gives them, so keep them apart and rank
    // them when read, Compass first, matching src/lib/imdb-rating.ts. Merging in arrival order would
    // make the badge depend on which request happened to finish last.
    const publish = (source: "compass" | "omdb", ratings: Map<string, number>) => {
      const valid = new Map<string, number>();
      for (const [coordinate, rating] of ratings) {
        if (Number.isFinite(rating) && rating > 0 && rating <= 10) valid.set(coordinate, rating);
      }
      if (cancelled || valid.size === 0) return;
      setResult((previous) => {
        const held = previous.key === key ? previous : null;
        return {
          key,
          compass: source === "compass" ? valid : (held?.compass ?? new Map<string, number>()),
          omdb: source === "omdb" ? valid : (held?.omdb ?? new Map<string, number>()),
        };
      });
    };
    if (imdbId?.match(/^tt\d+$/)) {
      // Independent requests: a retired Compass server must not hold up OMDb.
      void compassImdbEpisodes(imdbId)
        .then((ratings) => publish("compass", ratings))
        .catch(() => {});
      if (omdbKey && season >= 1) {
        void omdbSeasonRatings(omdbKey, imdbId, season)
          .then((ratings) =>
            publish(
              "omdb",
              new Map([...ratings].map(([ep, rating]) => [`${season}:${ep}`, rating])),
            ),
          )
          .catch(() => {});
      }
    }
    return () => {
      cancelled = true;
    };
  }, [key, imdbId, season, omdbKey]);
  return useMemo(() => {
    if (result.key !== key) return new Map<string, number>();
    return new Map([...result.omdb, ...result.compass]);
  }, [result, key]);
}
