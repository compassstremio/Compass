import { useMemo } from "react";
import type { Meta } from "@/lib/cinemeta";
import { matchingEpisodeVideos } from "@/lib/episode-search";
import { useLocalAwareSeriesPlay } from "@/lib/local-library/use-series-play";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { EpisodeResultRow } from "./episode-result-row";

type Video = NonNullable<Meta["videos"]>[number];

export function CrossSeasonResults({
  meta,
  videos,
  playbackVideos,
  query,
  imdbId,
  loading = false,
}: {
  meta: Meta;
  videos?: Meta["videos"];
  playbackVideos?: Meta["videos"];
  query: string;
  imdbId?: string | null;
  loading?: boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const playLocalAware = useLocalAwareSeriesPlay();
  const results = useMemo<Video[]>(() => {
    return matchingEpisodeVideos(videos ?? [], query);
  }, [videos, query]);

  if (results.length === 0) {
    return (
      <p className="py-10 text-center text-[14px] text-ink-muted">
        {loading ? t("Loading episodes...") : t('No episodes match "{q}"', { q: query })}
      </p>
    );
  }

  const play = (v: Video) =>
    playLocalAware({
      meta,
      episode: {
        season: v.season ?? 1,
        episode: v.episode ?? 1,
        name: v.name || undefined,
        still: v.thumbnail || undefined,
      },
      opts: { autoPlay: settings.instantPlay || settings.seasonSourceLock },
      imdbId,
      videos: playbackVideos ?? videos,
    });

  return (
    <div className="flex flex-col gap-1.5">
      {results.map((v) => (
        <EpisodeResultRow
          key={v.id ?? `${v.season}-${v.episode}`}
          video={v}
          onPlay={() => play(v)}
        />
      ))}
    </div>
  );
}
