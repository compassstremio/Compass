import { pmdbRequest } from "./client";
import { isAuthenticated } from "./session";
import type { Meta } from "@/lib/cinemeta";
import type {
  PmdbList,
  PmdbListItem,
  PmdbListItemsResponse,
  PmdbListsResponse,
  PmdbTarget,
} from "./types";

let cachedWatchlistId: string | null = null;

export function clearPmdbWatchlistCache(): void {
  cachedWatchlistId = null;
}

async function getWatchlistId(strict = false): Promise<string | null> {
  if (cachedWatchlistId && !strict) return cachedWatchlistId;
  try {
    const res = await pmdbRequest<PmdbListsResponse>("/api/external/lists", {
      method: "GET",
    });
    if (strict && !Array.isArray(res?.items))
      throw new Error("PublicMetaDB lists could not be read safely.");
    const watchlist = res?.items?.find((l: PmdbList) => l.type === "watchlist");
    if (watchlist?.id) {
      cachedWatchlistId = watchlist.id;
      return watchlist.id;
    }
    return null;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

const WATCHLIST_PER_PAGE = 100;
const WATCHLIST_MAX_PAGES = 10;

export async function fetchPmdbWatchlist(
  options: { strict?: boolean; assertCurrent?: () => void } = {},
): Promise<PmdbListItem[]> {
  options.assertCurrent?.();
  if (!isAuthenticated()) {
    if (options.strict) throw new Error("PublicMetaDB is disconnected.");
    return [];
  }
  const listId = await getWatchlistId(options.strict);
  options.assertCurrent?.();
  if (!listId) {
    if (options.strict) throw new Error("A PublicMetaDB watchlist is unavailable.");
    return [];
  }

  // List items paginate (page/perPage, max 500). Loop defensively: stop on a
  // short page so an envelope without page counts still terminates.
  const out: PmdbListItem[] = [];
  const pageSignatures = new Set<string>();
  try {
    for (let page = 1; page <= WATCHLIST_MAX_PAGES; page++) {
      options.assertCurrent?.();
      const res = await pmdbRequest<PmdbListItemsResponse>(
        `/api/external/lists/${encodeURIComponent(listId)}/items?page=${page}&perPage=${WATCHLIST_PER_PAGE}`,
        { method: "GET" },
      );
      options.assertCurrent?.();
      if (options.strict && !Array.isArray(res?.items))
        throw new Error("PublicMetaDB watchlist could not be read safely.");
      const items = res?.items ?? [];
      const signature = JSON.stringify(items);
      if (options.strict && items.length && pageSignatures.has(signature))
        throw new Error("PublicMetaDB repeated a watchlist page.");
      pageSignatures.add(signature);
      out.push(...items);
      if (items.length < WATCHLIST_PER_PAGE) {
        if (options.strict && Number.isFinite(res.total) && out.length < res.total)
          throw new Error("PublicMetaDB returned an incomplete watchlist.");
        return out;
      }
    }
    if (options.strict)
      throw new Error("The complete PublicMetaDB watchlist could not be checked.");
  } catch (error) {
    if (options.strict) throw error;
    /* return what we have */
  }
  return out;
}

export function pmdbWatchlistContains(
  items: PmdbListItem[],
  target: PmdbTarget,
): PmdbListItem | null {
  if (target.tmdb_id == null) return null;
  return (
    items.find((i) => i.tmdb_id === target.tmdb_id && i.media_type === target.media_type) ?? null
  );
}

/**
 * Maps a watchlist item to a Compass Meta for grid rendering. The poster
 * field shape is unverified (full URL vs TMDB path vs absent), so all three
 * are handled and title-only cards remain renderable.
 */
export function pmdbWatchlistItemToMeta(item: PmdbListItem): Meta | null {
  if (item.tmdb_id == null) return null;
  const isMovie = item.media_type === "movie";
  let poster: string | undefined;
  const raw = typeof item.poster === "string" ? item.poster.trim() : "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    poster = raw;
  } else if (raw.startsWith("/") && raw.length > 1) {
    poster = `https://image.tmdb.org/t/p/w500${raw}`;
  }
  return {
    id: isMovie ? `tmdb:movie:${item.tmdb_id}` : `tmdb:tv:${item.tmdb_id}`,
    type: isMovie ? "movie" : "series",
    name: item.title || (isMovie ? `Movie (${item.tmdb_id})` : `Series (${item.tmdb_id})`),
    releaseInfo: item.year != null ? String(item.year) : undefined,
    poster,
  };
}

export async function addToPmdbWatchlist(
  target: PmdbTarget,
  options: { assertCurrent?: () => void } = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  // Add-to-list takes tmdb_id + media_type only; resolve first, never send
  // ID-only targets the server must reject.
  if (target.tmdb_id == null) return false;
  const listId = await getWatchlistId();
  options.assertCurrent?.();
  if (!listId) return false;

  try {
    await pmdbRequest(`/api/external/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      body: {
        tmdb_id: target.tmdb_id,
        media_type: target.media_type,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function removeFromPmdbWatchlist(
  target: PmdbTarget,
  options: { assertCurrent?: () => void } = {},
): Promise<boolean> {
  options.assertCurrent?.();
  if (!isAuthenticated()) return false;
  const listId = await getWatchlistId();
  options.assertCurrent?.();
  if (!listId) return false;

  try {
    // Fetch items to find matching itemId
    const items = await fetchPmdbWatchlist({ assertCurrent: options.assertCurrent });
    options.assertCurrent?.();
    const item = pmdbWatchlistContains(items, target);
    if (!item?.id) return false;

    await pmdbRequest(
      `/api/external/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(item.id)}`,
      {
        method: "DELETE",
      },
    );
    return true;
  } catch {
    return false;
  }
}
