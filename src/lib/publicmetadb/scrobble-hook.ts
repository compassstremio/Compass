import { useEffect, useLayoutEffect, useRef } from "react";
import { getPlaybackPosition } from "@/lib/player/playback-clock";
import { useSettings } from "@/lib/settings";
import type { PlayerSrc } from "@/lib/view";
import { resolvePmdbEpisodeTarget, resolvePmdbTarget } from "./ids";
import { usePublicMetaDb } from "./provider";
import { pmdbDeleteResumeForTarget, pmdbSaveResume } from "./scrobble";
import { recordPendingResume, syncPendingResume } from "./pending-sync";
import { markPmdbWatched } from "./history";
import type { PmdbTarget } from "./types";

type Snap = {
  status: string;
  positionSec: number;
  durationSec: number;
};

const STUB_MAX_SEC = 120;
const COMPLETION_RATIO = 0.9;
// Position snapshots are crash insurance only; PMDB asks for event-based
// saves (pause/stop/close), and each save counts against a 300/hour budget.
const MIN_SAVE_INTERVAL_MS = 60_000;
const SEEK_SAVE_DEBOUNCE_MS = 800;

export function usePublicMetaDbScrobble({ src, snap }: { src: PlayerSrc; snap: Snap }): void {
  const { isConnected } = usePublicMetaDb();
  const { settings } = useSettings();
  const enabled = isConnected && settings.publicmetadbScrobbleEnabled;

  const targetRef = useRef<PmdbTarget | null>(null);
  const durationRef = useRef(0);
  const maxPosRef = useRef(0);
  const lastPosRef = useRef(0);
  const pageHiddenRef = useRef(false);
  const lastSaveTimeRef = useRef(0);
  const lastSavedPosRef = useRef(-1);
  const endedHandledRef = useRef(false);
  const completionRef = useRef({ inFlight: false, done: false, retryAt: 0 });
  const seekTrackRef = useRef({ pos: 0, at: 0 });
  const pendingSeekTimerRef = useRef<number | null>(null);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const statusRef = useRef(snap.status);
  statusRef.current = snap.status;

  const metaId = src.meta.id;
  const season = src.episode?.season;
  const episode = src.episode?.episode;
  const key = `${metaId}|${season ?? ""}|${episode ?? ""}`;
  const lastKeyRef = useRef<string | null>(null);

  const clearPendingSeek = () => {
    if (pendingSeekTimerRef.current != null) {
      window.clearTimeout(pendingSeekTimerRef.current);
      pendingSeekTimerRef.current = null;
    }
  };

  // Persist before sending so shutdown or a failed request cannot lose progress.
  // A real page unload leaves replay to the provider; player navigation can sync now.
  const saveOrWatched = (
    target: PmdbTarget | null,
    posSec: number,
    durSec: number,
    mode: "live" | "unload" = "live",
  ) => {
    if (!target || durSec < STUB_MAX_SEC) return;
    const clampedPos = Math.max(0, Math.min(durSec, Number.isFinite(posSec) ? posSec : 0));
    const ratio = durSec > 0 ? clampedPos / durSec : 0;
    if (ratio < 0.02) return;

    const posMs = Math.round(clampedPos * 1000);
    const durMs = Math.round(durSec * 1000);

    if (ratio >= COMPLETION_RATIO) {
      const completion = completionRef.current;
      if (completion.done || completion.inFlight) return;
      if (mode === "live" && Date.now() < completion.retryAt) return;
      if (mode === "unload") {
        recordPendingResume(target, posMs, durMs);
        return;
      }
      completion.inFlight = true;
      completion.retryAt = Date.now() + MIN_SAVE_INTERVAL_MS;
      lastSaveTimeRef.current = Date.now();
      lastSavedPosRef.current = clampedPos;
      // A completed flush replays as a 100% resume save, which the server
      // answers as completed and converts to watched + resume cleanup.
      void syncPendingResume(target, posMs, durMs, async () => {
        const ok = await markPmdbWatched(target);
        if (!ok) return false;
        await pmdbDeleteResumeForTarget(target);
        return true;
      })
        .then((ok) => { completion.done = ok; })
        .finally(() => {
          completion.inFlight = false;
        });
      return;
    }

    if (mode === "unload") {
      recordPendingResume(target, posMs, durMs);
      return;
    }

    lastSaveTimeRef.current = Date.now();
    lastSavedPosRef.current = clampedPos;

    void syncPendingResume(target, posMs, durMs, () =>
      pmdbSaveResume(target, posMs, durMs).then((res) => res != null),
    );
  };

  // Track latest usable duration for the current key. Updated from the live
  // snapshot so interval/pause/pagehide handlers never read a stale closure.
  useEffect(() => {
    if (lastKeyRef.current !== key) return;
    if (snap.durationSec >= STUB_MAX_SEC) durationRef.current = snap.durationSec;
  }, [key, snap.durationSec]);

  // Resolve target whenever media identity changes. Cleanup flushes the
  // previous item from refs (still holding prev values at cleanup time).
  useEffect(() => {
    const prevKey = lastKeyRef.current;
    if (prevKey && prevKey !== key) {
      clearPendingSeek();
      if (enabledRef.current) {
        const t = targetRef.current;
        const d = durationRef.current;
        const p = lastPosRef.current;
        if (t && d >= STUB_MAX_SEC && p > 0) saveOrWatched(t, p, d);
      }
    }
    lastKeyRef.current = key;

    let cancelled = false;
    targetRef.current = null;
    durationRef.current = snap.durationSec >= STUB_MAX_SEC ? snap.durationSec : 0;
    maxPosRef.current = 0;
    lastPosRef.current = 0;
    endedHandledRef.current = false;
    completionRef.current = { inFlight: false, done: false, retryAt: 0 };
    lastSaveTimeRef.current = 0;
    lastSavedPosRef.current = -1;

    void (async () => {
      let resolved: PmdbTarget | null = null;
      if (src.episode) {
        resolved = await resolvePmdbEpisodeTarget(
          metaId,
          {
            season: src.episode.season,
            episode: src.episode.episode,
            imdbSeason: src.episode.imdbSeason,
            imdbEpisode: src.episode.imdbEpisode,
            absoluteNumber: src.episode.absoluteNumber,
          },
          src.imdbId,
        ).catch(() => null);
      } else {
        const type = src.meta.type === "series" ? "series" : "movie";
        resolved = await resolvePmdbTarget(metaId, type).catch(() => null);
        if (!resolved && src.imdbId) {
          resolved = {
            id_type: "imdb",
            id_value: src.imdbId,
            media_type: type === "series" ? "tv" : "movie",
          };
        }
      }
      if (!cancelled) {
        targetRef.current = resolved;
        const live = getPlaybackPosition();
        lastPosRef.current = live;
        if (live > maxPosRef.current) maxPosRef.current = live;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    metaId,
    season,
    episode,
    src.episode?.imdbSeason,
    src.episode?.imdbEpisode,
    src.episode?.absoluteNumber,
    src.imdbId,
    src.meta.type,
  ]);

  // Active playback interval: periodically saves progress & detects seeks.
  useEffect(() => {
    if (!enabled) return;
    if (snap.status !== "playing" && snap.status !== "paused") return;

    seekTrackRef.current = { pos: getPlaybackPosition(), at: Date.now() };

    const intervalId = window.setInterval(() => {
      if (!enabledRef.current) return;
      const dur = durationRef.current || snap.durationSec;
      if (dur < STUB_MAX_SEC) return;
      const now = Date.now();
      const pos = getPlaybackPosition();
      lastPosRef.current = pos;
      if (pos > maxPosRef.current) maxPosRef.current = pos;

      const prev = seekTrackRef.current;
      const dPos = pos - prev.pos;
      const dT = Math.max(0.001, (now - prev.at) / 1000);
      seekTrackRef.current = { pos, at: now };

      const isSeek = Math.abs(dPos) > 4 && (dT < 1.5 || Math.abs(dPos / dT) > 2.5);
      if (isSeek) {
        clearPendingSeek();
        pendingSeekTimerRef.current = window.setTimeout(() => {
          pendingSeekTimerRef.current = null;
          if (!enabledRef.current) return;
          const live = getPlaybackPosition();
          lastPosRef.current = live;
          if (live > maxPosRef.current) maxPosRef.current = live;
          const t = targetRef.current;
          const d = durationRef.current;
          if (t && d >= STUB_MAX_SEC) saveOrWatched(t, live, d);
        }, SEEK_SAVE_DEBOUNCE_MS);
        return;
      }

      if (statusRef.current === "playing") {
        const timeSinceSave = now - lastSaveTimeRef.current;
        const posChange = Math.abs(pos - lastSavedPosRef.current);
        if (timeSinceSave >= MIN_SAVE_INTERVAL_MS && posChange >= 10) {
          const t = targetRef.current;
          if (t) saveOrWatched(t, pos, dur);
        }
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
      clearPendingSeek();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, snap.status]);

  // Playback state transitions: paused saves, ended marks watched (or saves).
  // Uses maxPosRef so a natural end that resets position still completes.
  useEffect(() => {
    if (!enabled) return;
    const t = targetRef.current;
    if (!t) return;
    const dur = durationRef.current || snap.durationSec;
    if (dur < STUB_MAX_SEC) return;

    if (snap.status === "ended") {
      if (endedHandledRef.current) return;
      endedHandledRef.current = true;
      clearPendingSeek();
      const live = getPlaybackPosition();
      const best = Math.max(live, maxPosRef.current);
      saveOrWatched(t, best, dur);
      return;
    }

    if (snap.status === "paused") {
      clearPendingSeek();
      const live = getPlaybackPosition();
      if (live > maxPosRef.current) maxPosRef.current = live;
      lastPosRef.current = live;
      saveOrWatched(t, live, dur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, snap.status]);

  // Page hide / app close. Registered once; reads refs so no stale closures.
  useEffect(() => {
    const onPageHide = () => {
      pageHiddenRef.current = true;
      if (!enabledRef.current) return;
      clearPendingSeek();
      const t = targetRef.current;
      const dur = durationRef.current;
      if (!t || dur < STUB_MAX_SEC) return;
      const live = getPlaybackPosition();
      const best = statusRef.current === "ended" ? Math.max(live, maxPosRef.current) : live;
      saveOrWatched(t, best, dur, "unload");
    };

    const onPageShow = () => { pageHiddenRef.current = false; };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Capture the live clock before the bridge's passive cleanup resets it.
  useLayoutEffect(() => {
    return () => {
      if (!enabledRef.current) return;
      clearPendingSeek();
      const t = targetRef.current;
      const dur = durationRef.current;
      if (!t || dur < STUB_MAX_SEC) return;
      const live = getPlaybackPosition();
      const best = statusRef.current === "ended" ? Math.max(live, maxPosRef.current) : live;
      saveOrWatched(t, best, dur, pageHiddenRef.current ? "unload" : "live");
    };
  }, []);
}
