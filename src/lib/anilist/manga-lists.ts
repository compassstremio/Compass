import { AnilistApiError, anilistRequest } from "./client";
import type { AnilistListGroup, AnilistMediaEntry, MediaListStatus } from "./types";
import { validateAnilistSession } from "./validate";

const COLLECTION_QUERY = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: MANGA) {
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
          chapters
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

const CACHE_PREFIX = "compass.anilist.mangacollection.v1.";
const memCache = new Map<number, AnilistListGroup[]>();
const inflight = new Map<number, Promise<AnilistListGroup[]>>();

export function resetMangaForProfile() {
  memCache.clear();
  inflight.clear();
}

function cacheKey(userId: number): string {
  return CACHE_PREFIX + userId;
}

export function readCachedMangaCollection(userId: number): AnilistListGroup[] | null {
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

function writeCachedMangaCollection(userId: number, groups: AnilistListGroup[]): void {
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
      const entries = group.entries.filter((entry) => entry.media.format !== "NOVEL");
      if (name && entries.length > 0)
        custom.push({ status: null, name, isCustomList: true, entries });
      continue;
    }
    if (!group.status) continue;
    const bucket = byStatus.get(group.status) ?? [];
    for (const entry of group.entries) {
      if (entry.media.format === "NOVEL") continue;
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

export async function fetchMangaListCollection(userId: number): Promise<AnilistListGroup[]> {
  const existing = inflight.get(userId);
  if (existing) return existing;
  const run = (async () => {
    const data = await anilistRequest<CollectionResponse>(COLLECTION_QUERY, { userId }).catch(
      (e) => {
        if (e instanceof AnilistApiError && e.status === 401) void validateAnilistSession();
        return null;
      },
    );
    if (data == null) {
      const cached = readCachedMangaCollection(userId);
      return cached ?? [];
    }
    const groups = buildGroups(data.MediaListCollection?.lists ?? []);
    writeCachedMangaCollection(userId, groups);
    return groups;
  })();
  inflight.set(userId, run);
  try {
    return await run;
  } finally {
    inflight.delete(userId);
  }
}
