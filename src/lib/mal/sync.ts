import { activeProfileId } from "@/lib/active-profile-id";
import { malRequest, MalApiError } from "./client";
import { resolveMalMediaId } from "./mutations";
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

const SENT_KEY_BASE = "compass.mal.synced.v1";
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

// Titles that have ever been completed/rewatching. The `sent` map is keyed by
// episode, so it cannot tell a first watch from a rewatch — once a title is known
// to be finished, the per-episode fast-path steps aside so a second pass over an
// already-pinned episode is not skipped forever.
const REWATCH_KEY_BASE = "compass.mal.rewatch.v1";
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
const REWATCH_DONE_KEY_BASE = "compass.mal.rewatch-done.v1";
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

type EntryResponse = {
  num_episodes: number | null;
  my_list_status: {
    num_episodes_watched: number;
    status: string;
    is_rewatching: boolean;
    num_times_rewatched: number;
  } | null;
};

type SaveResponse = {
  num_episodes_watched: number;
  status: string;
};

const inflight = new Set<string>();
const watchingMarked = new Set<string>();
// A rewatch we just finished keeps its finale emitting progress events; without
// this the next tick would read completed and start the rewatch all over again.
const rewatchCompleted = new Map<string, number>();

export function resetForProfile(): void {
  inflight.clear();
  watchingMarked.clear();
  rewatchCompleted.clear();
}

export async function markMalWatching(compassId: string, title: string): Promise<void> {
  if (!isAuthenticated()) return;
  const profile = activeProfileId();
  const session = getSession();
  const owned = () => activeProfileId() === profile && getSession() === session;
  if (watchingMarked.has(compassId)) return;
  watchingMarked.add(compassId);
  try {
    const malId = await resolveMalMediaId(compassId);
    if (!owned() || malId == null) {
      watchingMarked.delete(compassId);
      return;
    }
    const cur = await malRequest<EntryResponse>(
      `/anime/${malId}?fields=num_episodes,my_list_status`,
    );
    if (!owned()) return;
    if (cur?.my_list_status && cur.my_list_status.status !== "plan_to_watch") return;
    const total = cur?.num_episodes ?? 0;
    if (cur?.my_list_status && total > 0 && cur.my_list_status.num_episodes_watched >= total)
      return;
    await malRequest<SaveResponse>(`/anime/${malId}/my_list_status`, {
      method: "PATCH",
      body: new URLSearchParams({ status: "watching" }),
    });
    if (owned()) emit({ kind: "watching", title });
  } catch (e) {
    watchingMarked.delete(compassId);
    if (e instanceof MalApiError && e.status === 401) return;
  }
}

export async function syncMalProgress(
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
  // Finished/rewatching titles skip the per-episode fast-path (see RewatchMap).
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
    const malId = await resolveMalMediaId(compassId);
    if (!owned() || malId == null) return;

    const cur = await malRequest<EntryResponse>(
      `/anime/${malId}?fields=num_episodes,my_list_status`,
    );

    if (!owned()) return;
    const listStatus = cur?.my_list_status;
    const current = listStatus?.num_episodes_watched ?? 0;
    const total = cur?.num_episodes ?? 0;

    // The user already finished (or is rewatching) this title. A plain watching
    // push would drop it back to "watching" and overwrite the progress, so keep
    // the rewatch flag set and only move the rewatch counter forward.
    if (listStatus && (listStatus.status === "completed" || listStatus.is_rewatching)) {
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
      // this the next tick would read completed and start the rewatch over.
      const completedEp = rewatchCompleted.get(compassId) ?? rewatchDone[compassId];
      if (completedEp != null && listStatus.status === "completed" && ep >= completedEp) return;

      // Watching the finale while rewatching finishes the pass. MAL counts a
      // finished rewatch as completed with `num_times_rewatched` bumped, and the
      // counter is a plain field — completing alone does not increment it.
      if (listStatus.is_rewatching && total > 0 && target >= total) {
        const timesRewatched = (listStatus.num_times_rewatched ?? 0) + 1;
        emit({ kind: "syncing", title, episode: total, rewatch: true });
        const saved = await malRequest<SaveResponse>(`/anime/${malId}/my_list_status`, {
          method: "PATCH",
          body: new URLSearchParams({
            num_watched_episodes: String(total),
            status: "completed",
            is_rewatching: "false",
            num_times_rewatched: String(timesRewatched),
          }),
        });
        if (saved?.num_episodes_watched === total) {
          rememberRewatchDone(ep);
          emit({ kind: "ok", title, episode: total, rewatch: true });
        } else {
          emit({ kind: "error", title, error: "update-not-confirmed" });
        }
        return;
      }

      // Starting a rewatch ignores the completed progress; continuing one is
      // forward-only, where equal is not backwards. A new pass clears the guard.
      if (listStatus.is_rewatching && target <= current) return;
      forgetRewatchDone();
      emit({ kind: "syncing", title, episode: target, rewatch: true });
      const saved = await malRequest<SaveResponse>(`/anime/${malId}/my_list_status`, {
        method: "PATCH",
        body: new URLSearchParams({
          num_watched_episodes: String(target),
          status: "watching",
          is_rewatching: "true",
        }),
      });
      if (saved?.num_episodes_watched === target) {
        emit({ kind: "ok", title, episode: target, rewatch: true });
      } else {
        emit({ kind: "error", title, error: "update-not-confirmed" });
      }
      return;
    }

    // The caller resolves entry-relative numbering before reaching this layer.
    const target = ep;
    if (total > 0 && target > total) return;
    if (target <= current) {
      rememberSent(sent, sentKey, Math.max(prevSent?.p ?? 0, current));
      saveSent(sent);
      return;
    }

    const status = total > 0 && target >= total ? "completed" : "watching";
    // Mark the title finished so a later rewatch is not swallowed by this
    // episode's first-watch entry in the fast-path above.
    if (status === "completed") {
      rewatch[compassId] = true;
      saveRewatch(rewatch);
    }
    emit({ kind: "syncing", title, episode: target });

    const saved = await malRequest<{ num_episodes_watched: number }>(
      `/anime/${malId}/my_list_status`,
      {
        method: "PATCH",
        body: new URLSearchParams({
          num_watched_episodes: String(target),
          status,
        }),
      },
    );

    if (!owned()) return;
    if (saved?.num_episodes_watched === target) {
      rememberSent(sent, sentKey, target);
      saveSent(sent);
      // A first-watch completion is not a finished rewatch: remember where it
      // happened so the finale's trailing progress ticks read completed and stop
      // instead of flipping the entry into a phantom rewatch.
      if (status === "completed") rememberRewatchDone(target);
      emit({ kind: "ok", title, episode: target });
    } else {
      // Unconfirmed writes stay retryable; recording them as sent would suppress retries.
      emit({ kind: "error", title, error: "update-not-confirmed" });
    }
  } catch (e) {
    if (!owned()) return;
    if (e instanceof MalApiError && e.status === 401) return;
    emit({ kind: "error", title, error: "unreachable" });
  } finally {
    inflight.delete(flightKey);
  }
}
