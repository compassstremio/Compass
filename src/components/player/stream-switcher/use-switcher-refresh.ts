import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDebridClients } from "@/lib/debrid/registry";
import { useSettings } from "@/lib/settings";
import { hasAnimeStreamIds, preferredAnimeImdbStreamId } from "@/lib/streams/stream-ids";
import { buildEpisodePipelineInput } from "@/lib/streams/episode-pipeline-input";
import { runPipeline } from "@/lib/streams/pipeline";
import { pluginCacheTokens } from "@/lib/streams/plugins";
import { buildPickerConfigHash, getPickerCache, setPickerCache } from "@/lib/picker-cache";
import { useStreamIds } from "@/views/play-picker/use-stream-ids";
import { useAddons } from "@/views/play-picker/use-addons";
import { stampAddonOrder } from "@/views/play-picker/picker-utils";
import type { Meta } from "@/lib/cinemeta";
import type { PlayEpisode } from "@/lib/view";

export function useSwitcherRefresh(params: {
  meta: Meta;
  episode: PlayEpisode | undefined;
  imdbId: string | null;
  imdbIdVerified: boolean;
  active: boolean;
}) {
  const { meta, episode, imdbId, imdbIdVerified, active } = params;
  const { authKey } = useAuth();
  const { settings } = useSettings();
  const debrids = useDebridClients();
  const { addons } = useAddons(authKey, settings);
  const [refreshing, setRefreshing] = useState(false);
  const acRef = useRef<AbortController | null>(null);
  const streamIds = useStreamIds(meta, episode, imdbId);
  const animePreference = streamIds && hasAnimeStreamIds(streamIds)
    ? settings.animePreferImdbStreams : undefined;
  const preferredAnimeImdbId = animePreference && streamIds
    ? preferredAnimeImdbStreamId(meta.id, episode, imdbId, imdbIdVerified, streamIds) : undefined;
  const strictMode = settings.streamFilterLevel === "strict";
  const filterDisabled = settings.streamFilterLevel === "off";
  const configHash = useMemo(
    () => buildPickerConfigHash({
      addonTransportUrls: (addons ?? []).map((a) => a.transportUrl),
      debridSlugs: debrids.map((d) => d.slug),
      scraperKeys: pluginCacheTokens(),
      filterMode: filterDisabled ? "off" : strictMode ? "strict" : "balanced",
      animePreferImdbStreams: animePreference,
      preferredAnimeImdbId,
    }),
    [addons, debrids, filterDisabled, strictMode, animePreference, preferredAnimeImdbId],
  );

  useEffect(() => {
    setRefreshing(false);
    return () => acRef.current?.abort();
  }, [configHash]);

  const refresh = useCallback(async () => {
    if (!addons || !streamIds) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setRefreshing(true);
    try {
      const input = buildEpisodePipelineInput({
        meta,
        episode,
        imdbId,
        imdbIdVerified,
        streamIds,
        addons,
        debrids,
        settings,
        strictMode,
        filterDisabled,
      });
      const result = await runPipeline(input, ac.signal, (partial) => {
        if (ac.signal.aborted || partial.picker.all.length === 0) return;
        stampAddonOrder(partial.picker.all, partial.raw.addon);
        setPickerCache(meta, episode, partial, configHash, false, animePreference);
      });
      if (ac.signal.aborted) return;
      stampAddonOrder(result.picker.all, result.raw.addon);
      setPickerCache(meta, episode, result, configHash, true, animePreference);
    } catch {
      // keep the existing cache on failure
    } finally {
      if (!ac.signal.aborted) setRefreshing(false);
    }
  }, [addons, debrids, meta, episode, imdbId, imdbIdVerified, settings, streamIds, configHash, animePreference, strictMode, filterDisabled]);

  const autoFilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      autoFilledRef.current = null;
      return;
    }
    if (!addons || !streamIds) return;
    const stamp = JSON.stringify([meta.id, episode?.season, episode?.episode, episode?.videoId, configHash]);
    if (autoFilledRef.current === stamp) return;
    if (getPickerCache(meta, episode, configHash)?.complete) return;
    autoFilledRef.current = stamp;
    void refresh();
  }, [active, addons, meta, episode, refresh, configHash, streamIds]);

  return { refreshing, refresh };
}
