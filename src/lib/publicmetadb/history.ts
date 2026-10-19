import { pmdbRequest } from "./client";
import { getTmdbForExternal } from "./mappings";
import { isAuthenticated } from "./session";
import type { PmdbTarget, PmdbWatchedItem, PmdbWatchedResponse } from "./types";

let cachedWatchedSet: Set<string> | null = null;
let lastFetchAt = 0;
const CACHE_TTL_MS = 30_000;
const WATCHED_PER_PAGE = 100;
const WATCHED_MAX_PAGES = 25;

export function invalidatePmdbWatchedCache(): void {
  cachedWatchedSet = null;
  lastFetchAt = 0;
}

function watchedQuery(target?: PmdbTarget, page = 1): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("perPage", String(WATCHED_PER_PAGE));
  if (target) {
    if (target.tmdb_id) params.set("tmdb_id", String(target.tmdb_id));
    if (target.media_type) params.set("media_type", target.media_type);
    if (target.id_type && target.id_value) {
      params.set("id_type", target.id_type);
      params.set("id_value", target.id_value);
    }
  }
  return `/api/external/watched?${params.toString()}`;
}

async function fetchWatchedPage(target: PmdbTarget | undefined, page: number) {
  return pmdbRequest<PmdbWatchedResponse>(watchedQuery(target, page), { method: "GET" });
}

/**
 * The watch-history GET documents only page/perPage, so server-side
 * filtering by show cannot be relied on. Resolve ID-only targets to a TMDB
 * id through the mappings API and filter items client-side instead.
 */
async function resolveTargetTmdb(target: PmdbTarget): Promise<PmdbTarget | null> {
  if (target.tmdb_id != null) return target;
  if (!target.id_type || !target.id_value) return null;
  const found = await getTmdbForExternal(target.id_type, target.id_value).catch(() => null);
  if (!found) return null;
  return { ...target, tmdb_id: found.tmdb_id };
}

export function watchedItemMatchesTarget(item: PmdbWatchedItem, target: PmdbTarget): boolean {
  if (target.tmdb_id != null && item.tmdb_id !== target.tmdb_id) return false;
  if (target.media_type && item.media_type !== target.media_type) return false;
  if (target.media_type !== "movie") {
    if (target.season != null && item.season !== target.season) return false;
    if (target.episode != null && item.episode !== target.episode) return false;
  }
  return true;
}

export async function fetchPmdbWatchedKeySet(
  target?: PmdbTarget,
  options: { strict?: boolean; assertCurrent?: () => void } = {},
): Promise<Set<string>> {
  options.assertCurrent?.();
  if (!isAuthenticated()) {
    if (options.strict) throw new Error("PublicMetaDB is disconnected.");
    return new Set();
  }

  const now = Date.now();
  if (!options.strict && !target && cachedWatchedSet && now - lastFetchAt < CACHE_TTL_MS) {
    return cachedWatchedSet;
  }

  const set = new Set<string>();
  // A targeted fetch belongs to one show, so bare `S:E` keys are safe there.
  // A global fetch spans shows, so only scoped keys may be added.
  const scopedOnly = !target;
  const effective = target ? await resolveTargetTmdb(target).catch(() => null) : undefined;
  options.assertCurrent?.();
  if (target && !effective) {
    if (options.strict) throw new Error("No verified PublicMetaDB identity is available.");
    return set;
  }

  try {
    const first = await fetchWatchedPage(target, 1);
    options.assertCurrent?.();
    if (options.strict && !Array.isArray(first?.items))
      throw new Error("PublicMetaDB watched history could not be read safely.");
    const items = Array.isArray(first?.items) ? first.items : [];
    const assertItems = (rows: PmdbWatchedItem[]) => {
      if (
        options.strict &&
        rows.some(
          (item) =>
            !item ||
            !Number.isInteger(item.tmdb_id) ||
            item.tmdb_id <= 0 ||
            (item.media_type !== "movie" && item.media_type !== "tv") ||
            (item.media_type === "tv" &&
              (!Number.isInteger(item.season) ||
                item.season! < 0 ||
                !Number.isInteger(item.episode) ||
                item.episode! < 1)),
        )
      )
        throw new Error("PublicMetaDB watched history contains an invalid identity.");
    };
    assertItems(items);
    for (const item of items) {
      if (effective && !watchedItemMatchesTarget(item, effective)) continue;
      addWatchedKeys(set, item, target, scopedOnly);
    }
    const reportedPages = Number(first?.totalPages ?? 1);
    const totalPages = Math.max(1, reportedPages || 1);
    if (
      options.strict &&
      (!Number.isInteger(reportedPages) ||
        reportedPages < 0 ||
        (reportedPages === 0 && items.length > 0) ||
        totalPages > WATCHED_MAX_PAGES ||
        (first.totalPages == null && items.length >= WATCHED_PER_PAGE))
    )
      throw new Error("The complete PublicMetaDB watched history could not be checked.");
    const pages = Math.min(totalPages, WATCHED_MAX_PAGES);
    const pageSignatures = new Set([JSON.stringify(items)]);
    for (let page = 2; page <= pages; page++) {
      try {
        options.assertCurrent?.();
        const data = await fetchWatchedPage(target, page);
        options.assertCurrent?.();
        if (options.strict && (!Array.isArray(data?.items) || !data.items.length))
          throw new Error("PublicMetaDB returned an incomplete watched history.");
        if (!Array.isArray(data?.items)) break;
        assertItems(data.items);
        const signature = JSON.stringify(data.items);
        if (options.strict && pageSignatures.has(signature))
          throw new Error("PublicMetaDB repeated a watched-history page.");
        pageSignatures.add(signature);
        for (const item of data.items) {
          if (effective && !watchedItemMatchesTarget(item, effective)) continue;
          addWatchedKeys(set, item, target, scopedOnly);
        }
        if (data.items.length === 0) break;
      } catch (error) {
        if (options.strict) throw error;
        break;
      }
    }

    if (!target) {
      cachedWatchedSet = set;
      lastFetchAt = now;
    }
  } catch (error) {
    if (options.strict) throw error;
    // Return empty or cached set on network failure
    return cachedWatchedSet ?? set;
  }

  return set;
}

function addWatchedKeys(
  set: Set<string>,
  item: PmdbWatchedItem,
  target?: PmdbTarget,
  scopedOnly = false,
): void {
  if (item.media_type === "movie") {
    if (item.tmdb_id) {
      set.add(`tmdb:movie:${item.tmdb_id}`);
    }
    if (target?.id_type === "imdb" && target.id_value) {
      set.add(`imdb:${target.id_value}`);
    }
  } else if (item.media_type === "tv") {
    if (item.season != null && item.episode != null) {
      if (!scopedOnly) {
        set.add(`${item.season}:${item.episode}`);
      }
      if (item.tmdb_id) {
        set.add(`tmdb:tv:${item.tmdb_id}:${item.season}:${item.episode}`);
      }
      if (target?.id_type === "imdb" && target.id_value) {
        set.add(`imdb:${target.id_value}:${item.season}:${item.episode}`);
      }
    }
  }
}

function watchedBody(target: PmdbTarget, watchedAt?: string) {
  const isMovie = target.media_type === "movie";
  return {
    tmdb_id: target.tmdb_id,
    media_type: target.media_type,
    // Movies are title-level; never send season/episode for them.
    ...(isMovie
      ? {}
      : {
          season: target.season,
          episode: target.episode,
        }),
    watched_at: watchedAt ?? new Date().toISOString(),
    id_type: target.id_type,
    id_value: target.id_value,
  };
}

export async function markPmdbWatched(
  target: PmdbTarget,
  watchedAt?: string,
  options: { assertCurrent?: () => void } = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  // Mark-watched requires a TMDB id; resolve ID-only targets first.
  const resolved = await resolveTargetTmdb(target).catch(() => null);
  options.assertCurrent?.();
  if (!resolved) return false;
  invalidatePmdbWatchedCache();

  try {
    await pmdbRequest("/api/external/watched", {
      method: "POST",
      body: watchedBody(resolved, watchedAt),
    });
    return true;
  } catch (err) {
    console.error("Failed to mark PublicMetaDB watched:", err);
    return false;
  }
}

function unmarkQuery(target: PmdbTarget): string {
  const params = new URLSearchParams();
  if (target.tmdb_id) params.set("tmdb_id", String(target.tmdb_id));
  params.set("media_type", target.media_type);
  if (target.media_type !== "movie") {
    if (target.season != null) params.set("season", String(target.season));
    if (target.episode != null) params.set("episode", String(target.episode));
  }
  if (target.id_type && target.id_value) {
    params.set("id_type", target.id_type);
    params.set("id_value", target.id_value);
  }
  return `/api/external/watched?${params.toString()}`;
}

export async function unmarkPmdbWatched(
  target: PmdbTarget,
  options: { assertCurrent?: () => void } = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  // Bulk delete requires a TMDB id; resolve ID-only targets first.
  const resolved = await resolveTargetTmdb(target).catch(() => null);
  options.assertCurrent?.();
  if (!resolved) return false;
  invalidatePmdbWatchedCache();

  try {
    await pmdbRequest(unmarkQuery(resolved), {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    console.error("Failed to unmark PublicMetaDB watched:", err);
    return false;
  }
}
