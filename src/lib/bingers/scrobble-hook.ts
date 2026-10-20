import { useEffect, useLayoutEffect, useRef } from "react";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { useSettings } from "@/lib/settings";
import type { PlayerSrc } from "@/lib/view";
import { resolveBingersTarget } from "./ids";
import { useBingers } from "./provider";
import type { BingersTarget } from "./types";

type Snap = {
  status: string;
  positionSec: number;
  durationSec: number;
};

const STUB_MAX_SEC = 120;
// Where Compass's own Continue Watching treats an item as finished.
const WATCHED_RATIO = 0.9;
const CHECK_INTERVAL_MS = 5000;

type Live = {
  key: string;
  target: BingersTarget | null;
  durationSec: number;
  maxPosSec: number;
  sent: boolean;
};

/**
 * Bingers records only finished items (its start/pause calls store nothing), so this
 * sends one watch per item once playback has covered 90% of it.
 */
export function useBingersScrobble({ src, snap }: { src: PlayerSrc; snap: Snap }): void {
  const { isConnected, recordWatch } = useBingers();
  const { settings } = useSettings();
  const enabled = isConnected && settings.bingersScrobbleEnabled !== false;

  const metaId = src.meta.id;
  const metaType = src.meta.type;
  const season = src.episode?.season;
  const episode = src.episode?.episode;
  const key = `${metaId}|${season ?? ""}|${episode ?? ""}`;

  // Interval, pagehide and unmount all read this one ref, so none of them can pair one
  // item's progress with another item's identity.
  const liveRef = useRef<Live>({ key, target: null, durationSec: 0, maxPosSec: 0, sent: false });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const recordRef = useRef(recordWatch);
  recordRef.current = recordWatch;

  const maybeSend = (posSec?: number) => {
    const live = liveRef.current;
    if (posSec != null && Number.isFinite(posSec) && posSec > live.maxPosSec)
      live.maxPosSec = posSec;
    if (!enabledRef.current || live.sent || !live.target) return;
    if (live.durationSec < STUB_MAX_SEC) return;
    if (live.maxPosSec / live.durationSec < WATCHED_RATIO) return;
    live.sent = true;
    void recordRef.current(live.target);
  };

  useEffect(() => {
    const target = resolveBingersTarget({
      metaId,
      metaType,
      episode: src.episode,
      imdbId: src.imdbId,
    });
    if (liveRef.current.key === key) {
      // Same item, better ids (the player resolves IMDb late): keep its progress.
      liveRef.current.target = target;
      return;
    }
    maybeSend();
    liveRef.current = { key, target, durationSec: 0, maxPosSec: 0, sent: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    metaId,
    metaType,
    src.imdbId,
    src.episode?.imdbId,
    src.episode?.imdbSeason,
    src.episode?.imdbEpisode,
    src.episode?.tvdbEpisodeId,
  ]);

  useEffect(() => {
    if (liveRef.current.key === key && snap.durationSec >= STUB_MAX_SEC) {
      liveRef.current.durationSec = snap.durationSec;
    }
  }, [key, snap.durationSec]);

  useEffect(() => {
    if (!enabled || snap.status !== "playing") return;
    const id = window.setInterval(() => maybeSend(getPlaybackPosition()), CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, snap.status, key]);

  // A seek to the credits followed by a pause, or a natural end, settles it at once.
  useEffect(() => {
    if (snap.status === "paused" || snap.status === "ended") maybeSend(getPlaybackPosition());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.status, enabled]);

  useEffect(() => {
    const onPageHide = () => maybeSend(getPlaybackPosition());
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the live clock before the bridge's passive cleanup resets it.
  useLayoutEffect(
    () => () => maybeSend(getPlaybackPosition()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
