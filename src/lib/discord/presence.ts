import type { MangaReadingState } from "@/lib/manga-reading-state";
import { stripColorTag } from "@/lib/manga/title";
import { mangaDiscordCover, onMangaCoverResolved } from "./manga-cover";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Discord strips buttons that link to its own invites: discord.gg makes it
// reject the whole activity (presence vanishes), discord.com/invite is dropped
// silently. A community-invite button needs a redirect on a domain we own.
const STATIC_BUTTONS = [
  { label: "Compass Website", url: "https://compass.sarl/" },
];
/** How long a paused song keeps its presence before it clears. */
const MUSIC_PAUSED_HIDE_MS = 3500;

type DiscordConfig = {
  enabled: boolean;
  hideTitle: boolean;
  showWhenPaused: boolean;
  showWhenBrowsing: boolean;
  showPoster: boolean;
  showTimestamp: boolean;
  showPartyJoin: boolean;
  showMusic: boolean;
  hideMusicWhenPaused: boolean;
};

export type MusicPresence = {
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  paused: boolean;
  positionSec: number;
  durationSec: number;
  trackUrl?: string;
  artistUrl?: string;
  albumUrl?: string;
};

export type PlaybackPresence = {
  title: string;
  subtitle?: string;
  metaId?: string;
  metaType?: string;
  posterUrl?: string;
  smallImageUrl?: string;
  year?: string | number;
  paused: boolean;
  positionSec: number;
  durationSec: number;
};

export type BrowsePresence = {
  details?: string;
  state?: string;
  largeImage?: string;
  largeText?: string;
  /** Marks a manga hint so the presence can substitute a Discord-safe cover. */
  kind?: "manga";
  /** Manga id, used to disambiguate a common title's poster by author. */
  id?: string;
};

export type PartyPresence = {
  id: string;
  size: number;
  joinUrl?: string;
};

let config: DiscordConfig = {
  enabled: false,
  hideTitle: false,
  showWhenPaused: true,
  showWhenBrowsing: true,
  showPoster: true,
  showTimestamp: true,
  showPartyJoin: true,
  showMusic: true,
  hideMusicWhenPaused: true,
};
let playback: PlaybackPresence | null = null;
let music: MusicPresence | null = null;
let reading: MangaReadingState = null;
let browse: BrowsePresence | null = null;
let party: PartyPresence | null = null;
let lastEnabledSent: boolean | null = null;
let lastKey = "";
let lastStartTs: number | null = null;
let flushTimer: number | null = null;
let musicPausedAt: number | null = null;
let musicHideTimer: number | null = null;

async function call(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!IS_TAURI) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd, args);
  } catch {
    /* discord not running or disabled; harmless */
  }
}

type Computed = { payload: Record<string, unknown> | null; key: string };
type Base = { payload: Record<string, unknown>; key: string } | null;

// Artwork is optional: the native side falls back to the Compass Discord asset when no
// poster is supplied, so a presence without an image still carries the logo.
function computeBase(): Base {
  if (playback && !(playback.paused && !config.showWhenPaused)) {
    if (config.hideTitle) {
      return {
        payload: {
          details: "Watching something",
          state: playback.paused ? "Paused" : undefined,
          paused: playback.paused,
        },
        key: `hide:${playback.paused}`,
      };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = playback.durationSec - playback.positionSec;
    const live = !playback.paused && playback.durationSec > 0 && remaining > 0;
    const state = playback.paused
      ? "Paused"
      : playback.subtitle || (playback.year != null ? String(playback.year) : undefined);
    return {
      payload: {
        details: playback.title,
        state,
        posterUrl: config.showPoster ? playback.posterUrl : undefined,
        smallImageUrl: (config.showPoster && playback.smallImageUrl) || undefined,
        largeText: playback.year != null ? `${playback.title} (${playback.year})` : playback.title,
        startTs:
          live && config.showTimestamp ? nowSec - Math.floor(playback.positionSec) : undefined,
        endTs: live && config.showTimestamp ? nowSec + Math.floor(remaining) : undefined,
        paused: playback.paused,
      },
      key: `play:${playback.title}|${state ?? ""}|${playback.paused}|${playback.posterUrl ?? ""}|${live ? "ts" : "nots"}`,
    };
  }
  if (music && config.showMusic && !party && !pausedMusicHidden()) {
    if (config.hideTitle) {
      return {
        payload: {
          details: "Listening to something",
          state: music.paused ? "Paused" : undefined,
          activityType: "listening",
          paused: music.paused,
        },
        key: `music:hide:${music.paused}`,
      };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = music.durationSec - music.positionSec;
    const live = !music.paused && music.durationSec > 0 && remaining > 0;
    // Discord renders details, state and the large-image text as three lines, so each line
    // carries one credit: the song, the artist, then the album. Repeating the album and
    // artist in two of them reads as a duplicate.
    const state = music.paused ? `Paused · ${music.artist}` : music.artist;
    const buttons = music.trackUrl
      ? [{ label: "Listen in Compass", url: music.trackUrl }, ...STATIC_BUTTONS]
      : STATIC_BUTTONS;
    return {
      payload: {
        details: music.title,
        detailsUrl: music.trackUrl,
        state,
        stateUrl: music.artistUrl ?? music.trackUrl,
        posterUrl: config.showPoster ? music.artwork : undefined,
        largeText: music.album,
        largeUrl: music.albumUrl ?? music.trackUrl,
        smallUrl: STATIC_BUTTONS[0].url,
        startTs: live && config.showTimestamp ? nowSec - Math.floor(music.positionSec) : undefined,
        endTs: live && config.showTimestamp ? nowSec + Math.floor(remaining) : undefined,
        activityType: "listening",
        paused: music.paused,
        buttons,
      },
      key: `music:${music.title}|${state}|${music.artwork ?? ""}|${live ? "ts" : "nots"}`,
    };
  }
  if (reading) {
    if (config.hideTitle) {
      return {
        payload: {
          details: "Reading something",
          state: reading.page > 0 ? `Page ${reading.page}/${reading.totalPages}` : undefined,
        },
        key: `read:hide:${reading.page}/${reading.totalPages}`,
      };
    }
    const state = `${reading.chapterLabel}, page ${reading.page}/${reading.totalPages}`;
    const title = stripColorTag(reading.title);
    const poster = config.showPoster
      ? mangaDiscordCover(reading.cover, title, reading.mangaId)
      : undefined;
    return {
      payload: {
        details: title,
        state,
        posterUrl: poster,
        largeText: title,
      },
      key: `read:${reading.title}|${state}|${poster ?? ""}`,
    };
  }
  if (browse && config.showWhenBrowsing) {
    if (config.hideTitle)
      return {
        payload: { details: "Browsing Compass" },
        key: "browse:hide",
      };
    const isManga = browse.kind === "manga";
    const details = isManga
      ? stripColorTag(browse.details ?? "Browsing Compass")
      : (browse.details ?? "Browsing Compass");
    const largeText = isManga
      ? stripColorTag(browse.largeText ?? browse.details ?? "")
      : (browse.largeText ?? browse.details);
    const poster = config.showPoster
      ? isManga
        ? mangaDiscordCover(browse.largeImage, largeText, browse.id)
        : browse.largeImage
      : undefined;
    return {
      payload: {
        details,
        state: browse.state,
        posterUrl: poster,
        largeText,
      },
      key: `browse:${browse.details ?? ""}|${browse.state ?? ""}|${poster ?? ""}`,
    };
  }
  if (party) {
    return { payload: { details: "In a Watch Party" }, key: "party-only" };
  }
  return null;
}

function compute(): Computed {
  const base = computeBase();
  if (party) {
    const headcount = Math.max(1, party.size);
    const payload: Record<string, unknown> = base ? { ...base.payload } : {};
    let context = base && !config.hideTitle ? (payload.details as string | undefined) : undefined;
    if (context && context.startsWith("Browsing Compass")) context = undefined;
    if (context && playback && !config.hideTitle) {
      const sub = payload.state as string | undefined;
      if (sub) context = `${context} · ${sub}`;
    }
    const people = headcount === 1 ? "1 👤" : `${headcount} 👥`;
    payload.details = `Watch Party · ${people}`;
    payload.state = context ?? "In the lobby";
    payload.buttons =
      party.joinUrl && config.showPartyJoin
        ? [{ label: "Join the Watch Party", url: party.joinUrl }, ...STATIC_BUTTONS]
        : STATIC_BUTTONS;
    const live = typeof payload.startTs === "number";
    return {
      payload,
      key: `party:${party.id}:${headcount}:${context ?? ""}:${party.joinUrl ?? ""}:${live ? "live" : "x"}`,
    };
  }
  if (!base) return { payload: null, key: "clear" };
  return { payload: { buttons: STATIC_BUTTONS, ...base.payload }, key: base.key };
}

function flush(): void {
  if (lastEnabledSent !== config.enabled) {
    lastEnabledSent = config.enabled;
    void call("discord_set_enabled", { on: config.enabled });
  }
  if (!config.enabled) {
    lastKey = "";
    lastStartTs = null;
    return;
  }
  const { payload, key } = compute();
  const startTs = payload && typeof payload.startTs === "number" ? payload.startTs : null;
  const seeked = startTs != null && lastStartTs != null && Math.abs(startTs - lastStartTs) > 4;
  if (key === lastKey && !seeked) return;
  lastKey = key;
  lastStartTs = startTs;
  if (payload) void call("discord_set_presence", { p: payload });
  else void call("discord_clear");
}

function schedule(): void {
  if (!IS_TAURI) return;
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flush();
  }, 800);
}

/** A discrete change (a new song) must not sit behind the debounce. */
function flushNow(): void {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  flush();
}

// An async AniList cover lookup landing after the first send must re-flush so
// the poster shows without waiting for the next page turn.
onMangaCoverResolved(schedule);

function clearMusicHideTimer(): void {
  if (musicHideTimer != null) {
    window.clearTimeout(musicHideTimer);
    musicHideTimer = null;
  }
}

/**
 * Arms the one-shot hide from the pause itself, so the presence clears on time even when no
 * other state changes while the song sits paused.
 */
function armMusicHideTimer(): void {
  if (music?.paused !== true || musicPausedAt == null || !config.hideMusicWhenPaused) {
    clearMusicHideTimer();
    return;
  }
  if (musicHideTimer != null) return;
  const wait = Math.max(0, MUSIC_PAUSED_HIDE_MS - (Date.now() - musicPausedAt));
  musicHideTimer = window.setTimeout(() => {
    musicHideTimer = null;
    // Flush at the deadline itself: the debounce would add up to another 800ms, and this
    // timer is already the precise moment the presence is supposed to go.
    flush();
  }, wait + 50);
}

/** True once a paused song should no longer occupy the presence. */
function pausedMusicHidden(): boolean {
  if (!music || !music.paused) return false;
  if (!config.showWhenPaused) return true;
  return (
    config.hideMusicWhenPaused &&
    musicPausedAt != null &&
    Date.now() - musicPausedAt >= MUSIC_PAUSED_HIDE_MS
  );
}

export function configureDiscord(next: DiscordConfig): void {
  config = next;
  lastKey = "";
  // Turning the setting on while a song is already paused starts its grace period now;
  // turning it off releases the pause so the song can show again.
  if (next.hideMusicWhenPaused) {
    if (music?.paused === true && musicPausedAt == null) musicPausedAt = Date.now();
  } else {
    musicPausedAt = null;
  }
  armMusicHideTimer();
  schedule();
}

export type ActivityState = { playback: PlaybackPresence | null; party: PartyPresence | null };

const activitySubs = new Set<(s: ActivityState) => void>();

function emitActivity(): void {
  const s: ActivityState = { playback, party };
  for (const fn of activitySubs) fn(s);
}

export function subscribeActivity(fn: (s: ActivityState) => void): () => void {
  activitySubs.add(fn);
  fn({ playback, party });
  return () => {
    activitySubs.delete(fn);
  };
}

export function setPlaybackPresence(p: PlaybackPresence | null): void {
  playback = p;
  schedule();
  emitActivity();
}

export function setMusicPresence(m: MusicPresence | null): void {
  const wasPaused = music?.paused === true;
  const isPaused = m?.paused === true;
  const changedTrack =
    m != null && (music == null || music.title !== m.title || music.artist !== m.artist);
  music = m;
  // The grace period starts when the song becomes paused (or a different paused song
  // arrives); a repeated publish of the same paused state must not restart the clock.
  if (!isPaused) musicPausedAt = null;
  else if (!wasPaused || changedTrack) musicPausedAt = Date.now();
  armMusicHideTimer();
  // A track change is a discrete moment; the debounce would leave Discord a step behind.
  if (changedTrack) flushNow();
  else schedule();
}

export function setReadingPresence(r: MangaReadingState): void {
  reading = r;
  schedule();
}

export function setBrowsePresence(b: BrowsePresence | null): void {
  browse = b;
  schedule();
}

export function setPartyPresence(p: PartyPresence | null): void {
  party = p;
  schedule();
  emitActivity();
}
