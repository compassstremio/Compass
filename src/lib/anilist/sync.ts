import { activeProfileId } from "@/lib/active-profile-id";
import { kitsuToAnilist } from "@/lib/providers/anime-mapping";
import { AnilistApiError, anilistRequest } from "./client";
import { isAuthenticated, getSession } from "./session";

export type SyncError = "update-not-confirmed" | "unreachable";

export type SyncEvent =
  | { kind: "syncing"; title: string; episode: number; rewatch?: boolean }
  | { kind: "ok"; title: string; episode: number; rewatch?: boolean }
  | { kind: "watching"; title: string }
  | { kind: "error"; title: string; error: SyncError };

const listeners = new Set<(e: SyncEvent) => void>();
let last: SyncEvent | null = null;

export function subscribeSync(fn: (e: SyncEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getLastSync(): SyncEvent | null {
  return last;
}

function emit(e: SyncEvent): void {
  last = e;
  for (const fn of listeners) fn(e);
}

const SENT_KEY_BASE = "compass.anilist.synced.v1";
function sentKey(): string {
  return `${SENT_KEY_BASE}.${activeProfileId()}`;
}
type SentValue = number | { p: number; t: number };
type SentMap = Record<string, SentValue>;

// Only collapses the per-tick writes of one playback session. Kept indefinitely it
// outlives the server, so removing the entry there could never be re-synced.
const SENT_TTL_MS = 60 * 1000;

function sentProgress(map: SentMap, key: string): { p: number; t: number } | null {
  const value = map[key];
  if (typeof value === "number") return { p: value, t: 0 };
  if (value && typeof value === "object" && typeof value.p === "number") {
    return { p: value.p, t: typeof value.t === "number" ? value.t : 0 };
  }
  return null;
}

function rememberSent(map: SentMap, key: string, progress: number): void {
  map[key] = { p: progress, t: Date.now() };
}

function loadSent(): SentMap {
  try {
    return JSON.parse(localStorage.getItem(sentKey()) ?? "{}") as SentMap;
  } catch {
    return {};
  }
}

function saveSent(map: SentMap): void {
  try {
    localStorage.setItem(sentKey(), JSON.stringify(map));
  } catch {
    return;
  }
}

// Titles that have ever been Completed/Rewatching. The `sent` map is keyed by
// episode, so it cannot tell a first watch from a rewatch — once a title is known
// to be finished, the per-episode fast-path steps aside so a second pass over an
// already-pinned episode is not skipped forever. Bounded by the number of finished
// titles, and re-read per call, so it survives profile switches and reloads.
const REWATCH_KEY_BASE = "compass.anilist.rewatch.v1";
function rewatchKey(): string {
  return `${REWATCH_KEY_BASE}.${activeProfileId()}`;
}
type RewatchMap = Record<string, true>;

function loadRewatch(): RewatchMap {
  try {
    return JSON.parse(localStorage.getItem(rewatchKey()) ?? "{}") as RewatchMap;
  } catch {
    return {};
  }
}

function saveRewatch(map: RewatchMap): void {
  try {
    localStorage.setItem(rewatchKey(), JSON.stringify(map));
  } catch {
    return;
  }
}

// The episode at which a finished rewatch was counted. Kept across restarts so
// replaying the finale cannot flip a completed entry into a phantom rewatch.
// Only multi-episode titles persist: for a movie, replaying its single episode
// is indistinguishable from the trailing ticks of the pass that just ended.
const REWATCH_DONE_KEY_BASE = "compass.anilist.rewatch-done.v1";
function rewatchDoneKey(): string {
  return `${REWATCH_DONE_KEY_BASE}.${activeProfileId()}`;
}
type RewatchDoneMap = Record<string, number>;

function loadRewatchDone(): RewatchDoneMap {
  try {
    return JSON.parse(localStorage.getItem(rewatchDoneKey()) ?? "{}") as RewatchDoneMap;
  } catch {
    return {};
  }
}

function saveRewatchDone(map: RewatchDoneMap): void {
  try {
    localStorage.setItem(rewatchDoneKey(), JSON.stringify(map));
  } catch {
    return;
  }
}

function leadingInt(value: string): number | null {
  const n = Number(value.split(":")[0]);
  return Number.isFinite(n) ? n : null;
}

const MAL_QUERY = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`;

async function malToAnilist(idMal: number): Promise<number | null> {
  try {
    const data = await anilistRequest<{ Media: { id: number } | null }>(MAL_QUERY, { idMal });
    return data?.Media?.id ?? null;
  } catch {
    return null;
  }
}

export async function resolveAnilistMediaId(compassId: string): Promise<number | null> {
  if (compassId.startsWith("anilist:")) return leadingInt(compassId.slice(8));
  if (compassId.startsWith("kitsu:")) {
    const k = leadingInt(compassId.slice(6));
    return k != null ? kitsuToAnilist(k) : null;
  }
  if (compassId.startsWith("mal:")) {
    const m = leadingInt(compassId.slice(4));
    return m != null ? malToAnilist(m) : null;
  }
  return null;
}

const ENTRY_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    episodes
    status
    mediaListEntry { id progress status repeat }
    relations {
      edges {
        relationType
        node {
          id
          episodes
          status
          mediaListEntry { id progress status }
        }
      }
    }
  }
}`;

type ListEntry = { id: number; progress: number; status: string; repeat?: number } | null;

type MediaNode = {
  id: number;
  episodes: number | null;
  status: string | null;
  mediaListEntry: ListEntry;
};

type RelationsResponse = {
  Media:
    | (MediaNode & {
        relations: {
          edges: Array<{ relationType: string; node: MediaNode | null }>;
        } | null;
      })
    | null;
};

type MediaRelations = NonNullable<RelationsResponse["Media"]>;

async function fetchMediaRelations(id: number): Promise<MediaRelations | null> {
  const data = await anilistRequest<RelationsResponse>(ENTRY_QUERY, { id });
  return data?.Media ?? null;
}

/**
 * AniList splits a franchise into per-cour entries (JoJo stages, Bleach TYBW)
 * while Kitsu/MAL keep one entry. When the mapped entry is finished and cannot
 * hold the episode, walk the sequels and subtract each entry's episode count
 * until the cour that aired it is found — the numbers are continuous across the
 * split, so the remainder is the episode inside that entry.
 */
async function resolveSplitEntry(
  media: MediaRelations,
  target: number,
): Promise<{ mediaId: number; episode: number; total: number; entry: ListEntry } | null> {
  const seen = new Set<number>([media.id]);
  let current = media;
  let remaining = target;
  for (let hop = 0; hop < 4; hop++) {
    const total = current.episodes ?? 0;
    // Only a finished entry is a safe hop: an airing one may simply not have
    // published its full episode count yet.
    if (current.status !== "FINISHED" || total <= 0 || remaining <= total) return null;
    remaining -= total;
    const sequel = current.relations?.edges?.find(
      (edge) => edge.relationType === "SEQUEL" && edge.node?.id != null,
    )?.node;
    if (!sequel || seen.has(sequel.id)) return null;
    seen.add(sequel.id);
    const sequelTotal = sequel.episodes ?? 0;
    if (sequelTotal > 0 && remaining <= sequelTotal) {
      return {
        mediaId: sequel.id,
        episode: remaining,
        total: sequelTotal,
        entry: sequel.mediaListEntry,
      };
    }
    const fetched = await fetchMediaRelations(sequel.id);
    if (!fetched) return null;
    current = fetched;
  }
  return null;
}

const SAVE_MUTATION = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
    id
    progress
    status
  }
}`;

// Finishing a rewatch: AniList counts it by flipping the entry to Completed and
// bumping `repeat`. The counter is a plain input field, so it has to be sent —
// a bare status change does not increment it.
const SAVE_REWATCH_DONE_MUTATION = `mutation ($mediaId: Int, $progress: Int, $repeat: Int) {
  SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: COMPLETED, repeat: $repeat) {
    id
    progress
    status
    repeat
  }
}`;

const SAVE_STATUS_MUTATION = `mutation ($mediaId: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status) {
    id
    status
  }
}`;

type EntryResponse = {
  Media: {
    id: number;
    episodes: number | null;
    mediaListEntry: { id: number; progress: number; status: string; repeat: number } | null;
  } | null;
};

type SaveResponse = {
  SaveMediaListEntry: { id: number; progress: number; status: string } | null;
};

type RewatchDoneResponse = {
  SaveMediaListEntry: { id: number; progress: number; status: string; repeat: number } | null;
};

const inflight = new Set<string>();
const watchingMarked = new Set<string>();
// A rewatch we just finished keeps its finale emitting progress events; without
// this the next tick would read COMPLETED and start the rewatch all over again.
const rewatchCompleted = new Map<string, number>();

export function resetForProfile(): void {
  inflight.clear();
  watchingMarked.clear();
  rewatchCompleted.clear();
}

export async function markAnimeWatching(compassId: string, title: string): Promise<void> {
  if (!isAuthenticated()) return;
  const profile = activeProfileId();
  const session = getSession();
  const owned = () => activeProfileId() === profile && getSession() === session;
  if (watchingMarked.has(compassId)) return;
  watchingMarked.add(compassId);
  try {
    const mediaId = await resolveAnilistMediaId(compassId);
    if (!owned() || mediaId == null) {
      watchingMarked.delete(compassId);
      return;
    }
    const cur = await anilistRequest<EntryResponse>(ENTRY_QUERY, { id: mediaId });
    if (!owned()) return;
    const entry = cur?.Media?.mediaListEntry;
    if (entry && entry.status !== "PLANNING") return;
    const total = cur?.Media?.episodes ?? 0;
    if (entry && total > 0 && entry.progress >= total) return;
    await anilistRequest<{ SaveMediaListEntry: { id: number } | null }>(SAVE_STATUS_MUTATION, {
      mediaId,
      status: "CURRENT",
    });
    if (owned()) emit({ kind: "watching", title });
  } catch (e) {
    watchingMarked.delete(compassId);
    if (e instanceof AnilistApiError && e.status === 401) return;
  }
}

export async function syncAnimeProgress(
  compassId: string,
  episode: number | undefined,
  title: string,
  season?: number,
  countRewatches = true,
): Promise<void> {
  if (!isAuthenticated()) return;
  const profile = activeProfileId();
  const session = getSession();
  const owned = () => activeProfileId() === profile && getSession() === session;
  const ep = episode ?? 1;
  if (!Number.isInteger(ep) || ep < 1) return;

  const sent = loadSent();
  const sentKey = `${compassId}|${season ?? ""}|${ep}`;
  const rewatch = loadRewatch();
  const rewatchDone = loadRewatchDone();
  const rememberRewatchDone = (episode: number) => {
    rewatchCompleted.set(compassId, episode);
    if (episode > 1) {
      rewatchDone[compassId] = episode;
      saveRewatchDone(rewatchDone);
    }
  };
  const forgetRewatchDone = () => {
    rewatchCompleted.delete(compassId);
    if (rewatchDone[compassId] != null) {
      delete rewatchDone[compassId];
      saveRewatchDone(rewatchDone);
    }
  };
  const prevSent = sentProgress(sent, sentKey);
  // Finished/repeating titles skip the per-episode fast-path (see RewatchMap).
  if (
    rewatch[compassId] !== true &&
    prevSent &&
    Date.now() - prevSent.t < SENT_TTL_MS &&
    prevSent.p >= ep
  ) {
    return;
  }

  const flightKey = `${profile}|${compassId}|${ep}`;
  if (inflight.has(flightKey)) {
    return;
  }
  inflight.add(flightKey);

  try {
    const mediaId = await resolveAnilistMediaId(compassId);
    if (!owned() || mediaId == null) return;

    const cur = await anilistRequest<RelationsResponse>(ENTRY_QUERY, { id: mediaId });
    if (!owned()) return;
    const media = cur?.Media;
    if (!media) return;

    // Never overwrite an entry the user deliberately moved to Completed or
    // Re-watching; auto-sync would otherwise flip it back to CURRENT. A split
    // franchise is the exception: the episode is beyond this entry, and the
    // write goes to the later cour that aired it (resolved below).
    const entryStatus = media.mediaListEntry?.status;
    const current = media.mediaListEntry?.progress ?? 0;
    const total = media.episodes ?? 0;
    const episodeBeyondEntry = total > 0 && ep > total;

    // The user already finished (or is rewatching) this title. A plain watched
    // push would send CURRENT and reset the entry's progress — AniList sets
    // progress to whatever it is sent, lower numbers included — so keep the entry
    // on REPEATING and only ever move the rewatch counter forward. That is what
    // renders the episodes as Rewatched rather than Watched.
    if ((entryStatus === "COMPLETED" || entryStatus === "REPEATING") && !episodeBeyondEntry) {
      // Rewatch recording is off: leave the finished entry exactly as the user
      // set it, the way the sync behaved before rewatches were supported.
      if (!countRewatches) return;
      // Remember the title as finished: the sent fast-path above is keyed by
      // episode and cannot tell a first watch from a rewatch, so it steps aside.
      if (rewatch[compassId] !== true) {
        rewatch[compassId] = true;
        saveRewatch(rewatch);
      }
      // The caller resolves entry-relative numbering before reaching this layer.
      const target = ep;
      if (total > 0 && target > total) return;
      // The finale of a rewatch we just finished keeps emitting progress; without
      // this the next tick would read COMPLETED and start the rewatch over.
      const completedEp = rewatchCompleted.get(compassId) ?? rewatchDone[compassId];
      if (completedEp != null && entryStatus === "COMPLETED" && ep >= completedEp) return;

      // Watching the finale while already Rewatching finishes the pass: AniList
      // counts a finished rewatch as Completed with `repeat` bumped.
      if (entryStatus === "REPEATING" && total > 0 && target >= total) {
        const repeat = (media.mediaListEntry?.repeat ?? 0) + 1;
        emit({ kind: "syncing", title, episode: total, rewatch: true });
        const saved = await anilistRequest<RewatchDoneResponse>(SAVE_REWATCH_DONE_MUTATION, {
          mediaId,
          progress: total,
          repeat,
        });
        if (saved?.SaveMediaListEntry?.progress === total) {
          rememberRewatchDone(ep);
          emit({ kind: "ok", title, episode: total, rewatch: true });
        } else {
          emit({ kind: "error", title, error: "update-not-confirmed" });
        }
        return;
      }

      // Starting a rewatch ignores the completed progress (AniList resets the
      // rewatch counter); continuing one is forward-only, where equal is not
      // backwards. A new pass clears the finished-rewatch guard above.
      if (entryStatus === "REPEATING" && target <= current) return;
      forgetRewatchDone();
      emit({ kind: "syncing", title, episode: target, rewatch: true });
      const saved = await anilistRequest<SaveResponse>(SAVE_MUTATION, {
        mediaId,
        progress: target,
        status: "REPEATING",
      });
      if (saved?.SaveMediaListEntry?.progress === target) {
        emit({ kind: "ok", title, episode: target, rewatch: true });
      } else {
        emit({ kind: "error", title, error: "update-not-confirmed" });
      }
      return;
    }

    // The caller resolves entry-relative numbering before reaching this layer.
    let target = ep;
    let writeId = mediaId;
    let entryProgress = current;
    let entryTotal = total;
    let splitWrite = false;
    if (total > 0 && target > total) {
      // A split franchise: the mapped entry is an earlier cour than the one
      // that aired this episode. Never silently drop it.
      const split = await resolveSplitEntry(media, target);
      if (!owned()) return;
      if (!split) return;
      const siblingStatus = split.entry?.status;
      if (siblingStatus === "COMPLETED" || siblingStatus === "REPEATING") return;
      writeId = split.mediaId;
      target = split.episode;
      entryTotal = split.total;
      entryProgress = split.entry?.progress ?? 0;
      splitWrite = true;
    }
    if (target <= entryProgress) {
      // A split write is recorded against the requested episode: the sent cache
      // above compares in the caller's numbering, not the cour's own.
      rememberSent(sent, sentKey, Math.max(prevSent?.p ?? 0, splitWrite ? ep : entryProgress));
      saveSent(sent);
      return;
    }

    const status = entryTotal > 0 && target >= entryTotal ? "COMPLETED" : "CURRENT";
    // Mark the title finished so a later rewatch is not swallowed by this
    // episode's first-watch entry in the fast-path above. A split write
    // completes the later cour, not this compassId's entry, so that entry stays
    // untouched.
    if (status === "COMPLETED" && !splitWrite) {
      rewatch[compassId] = true;
      saveRewatch(rewatch);
    }
    emit({ kind: "syncing", title, episode: target });

    const saved = await anilistRequest<SaveResponse>(SAVE_MUTATION, {
      mediaId: writeId,
      progress: target,
      status,
    });

    if (!owned()) return;
    if (saved?.SaveMediaListEntry?.progress === target) {
      // Split writes advance the sent cache in the caller's numbering so the
      // next autosave tick collapses instead of re-walking the franchise.
      rememberSent(sent, sentKey, splitWrite ? ep : target);
      saveSent(sent);
      // A first-watch completion is not a finished rewatch: remember where it
      // happened so the finale's trailing progress ticks read COMPLETED and stop
      // instead of flipping the entry into a phantom rewatch. A split write
      // completes the later cour, not this compassId's entry.
      if (status === "COMPLETED" && !splitWrite) rememberRewatchDone(target);
      emit({ kind: "ok", title, episode: target });
    } else {
      // Unconfirmed writes stay retryable; recording them as sent would suppress retries.
      emit({ kind: "error", title, error: "update-not-confirmed" });
    }
  } catch (e) {
    if (!owned()) return;
    if (e instanceof AnilistApiError && e.status === 401) return;
    emit({ kind: "error", title, error: "unreachable" });
  } finally {
    inflight.delete(flightKey);
  }
}
