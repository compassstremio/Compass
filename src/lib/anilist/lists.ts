import { AnilistApiError, anilistRequest } from "./client";
import type { AnilistListGroup, AnilistMediaEntry, MediaListStatus } from "./types";
import { validateAnilistSession } from "./validate";

const COLLECTION_QUERY = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists {
      status
      name
      isCustomList
      entries {
        id
        status
        progress
        score
        private
        media {
          id
          idMal
          title { romaji english native userPreferred }
          coverImage { extraLarge large medium }
          bannerImage
          format
          episodes
          averageScore
          seasonYear
        }
      }
    }
  }
}`;

type RawGroup = {
  status: MediaListStatus | null;
  name?: string | null;
  isCustomList: boolean;
  entries: AnilistMediaEntry[];
};

type CollectionResponse = { MediaListCollection: { lists: RawGroup[] } | null };

const CACHE_PREFIX = "compass.anilist.collection.v1.";
const memCache = new Map<number, AnilistListGroup[]>();
const inflight = new Map<number, Promise<AnilistListGroup[]>>();

export function resetForProfile() {
  memCache.clear();
  inflight.clear();
}

function cacheKey(userId: number): string {
  return CACHE_PREFIX + userId;
}

export function readCachedCollection(userId: number): AnilistListGroup[] | null {
  const mem = memCache.get(userId);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { groups?: AnilistListGroup[] };
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    memCache.set(userId, parsed.groups);
    return parsed.groups;
  } catch {
    return null;
  }
}

function writeCachedCollection(userId: number, groups: AnilistListGroup[]): void {
  memCache.set(userId, groups);
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ at: Date.now(), groups }));
  } catch {}
}

function buildGroups(lists: RawGroup[]): AnilistListGroup[] {
  const byStatus = new Map<MediaListStatus, AnilistMediaEntry[]>();
  const custom: AnilistListGroup[] = [];
  const seen = new Set<number>();
  for (const group of lists) {
    if (group.isCustomList) {
      const name = group.name?.trim();
      if (name && group.entries.length > 0)
        custom.push({ status: null, name, isCustomList: true, entries: group.entries });
      continue;
    }
    if (!group.status) continue;
    const bucket = byStatus.get(group.status) ?? [];
    // Status groups split COMPLETED by format, so the same entry repeats across them.
    for (const entry of group.entries) {
      if (seen.has(entry.media.id)) continue;
      seen.add(entry.media.id);
      bucket.push(entry);
    }
    byStatus.set(group.status, bucket);
  }
  return [
    ...Array.from(byStatus.entries()).map(([status, entries]) => ({ status, entries })),
    ...custom,
  ];
}

export async function fetchMediaListCollection(userId: number): Promise<AnilistListGroup[]> {
  const existing = inflight.get(userId);
  if (existing) return existing;
  const run = (async () => {
    const data = await anilistRequest<CollectionResponse>(COLLECTION_QUERY, { userId }).catch((e) => {
      if (e instanceof AnilistApiError && e.isAuthenticationError) void validateAnilistSession();
      throw e;
    });
    const groups = buildGroups(data.MediaListCollection?.lists ?? []);
    writeCachedCollection(userId, groups);
    return groups;
  })();
  inflight.set(userId, run);
  try {
    return await run;
  } finally {
    inflight.delete(userId);
  }
}
