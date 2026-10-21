import { safeFetch } from "@/lib/safe-fetch";
import { authenticatedFetch } from "@/lib/account/authenticated-fetch";
import { currentAuthor, subscribeAuthor } from "@/lib/theme-auth";
import { MANGA_PAGE, type MangaProvider } from "@/lib/manga/types";
import { toChapters, toStrings, toSummaries, toSummary, toTags } from "@/lib/manga/plugins/adapter";

// Sources served by Compass's own manga server (Compass-hosted services/compass-manga-addon).
// They need a Compass account: each account has one key, which this module fetches with the
// signed-in session and sends on every request. Signed out, there are no hosted sources.
// Page images load straight from the source site.

export const COMPASS_MANGA_URL = "https://manga.compass.sarl";

export type HostedSource = { id: string; name: string; lang: string; icon?: string };

/** Resolves the account's key; `fresh` skips the cache after the server rejected it. */
export type KeyGetter = (fresh?: boolean) => Promise<string | null>;

const STORAGE_KEY = "compass.manga.hosted.v1";

// What the server offered when this build shipped, so a signed-in reader has content before
// /api/sources has answered once.
const SHIPPED: HostedSource[] = [
  {
    id: "3asq",
    name: "مانجا العاشق",
    lang: "ar",
    icon: "https://3asq.online/wp-content/uploads/2021/06/cropped-ICON-270x270.png",
  },
  { id: "azorafly", name: "AzoraFly", lang: "ar", icon: "https://azorafly.com/favicon.ico" },
];

// Ids come from the server and are already percent-encoded path segments; validating instead
// of encoding keeps them byte-identical to the source's own URLs.
const SEGMENT = /^[A-Za-z0-9%._~-]{1,300}$/;
const CHAPTER = /^[A-Za-z0-9%._~-]{1,300}\/[A-Za-z0-9%._~-]{1,300}$/;
const SOURCE_ID = /^[a-z0-9-]{1,32}$/;
const KEY = /^cmp_[A-Za-z0-9_-]{43}$/;

export function hostedSourceId(id: string): string {
  return `compass-${id}`;
}

// ------------------------------------------------------------------------------- account key

let cachedKey: { userId: string; key: string } | null = null;
let pendingKey: Promise<string | null> | null = null;

async function fetchKey(userId: string): Promise<string | null> {
  try {
    const res = await authenticatedFetch(`${COMPASS_MANGA_URL}/account/key`);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const key = (body as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || !KEY.test(key)) return null;
    if (currentAuthor()?.id !== userId) return null;
    cachedKey = { userId, key };
    return key;
  } catch {
    return null;
  }
}

// The key lives in memory only: one request per app start (or after a reset on the account
// page) fetches it again, and it is never written to disk.
export const compassKey: KeyGetter = (fresh = false) => {
  const user = currentAuthor();
  if (!user) return Promise.resolve(null);
  if (!fresh && cachedKey?.userId === user.id) return Promise.resolve(cachedKey.key);
  pendingKey ??= fetchKey(user.id).finally(() => {
    pendingKey = null;
  });
  return pendingKey;
};

// Sends one request with the key, and once more with a fresh key if the server refused it
// (the key was reset on another device).
async function keyedFetch(url: string, getKey: KeyGetter): Promise<Response> {
  const key = await getKey();
  if (!key) throw new Error("sign in to Compass to read from Compass sources");
  const res = await safeFetch(url, { headers: { "X-Compass-Key": key } });
  if (res.status !== 401) return res;
  const fresh = await getKey(true);
  if (!fresh || fresh === key) return res;
  return safeFetch(url, { headers: { "X-Compass-Key": fresh } });
}

// ------------------------------------------------------------------------------- source list

export function toHostedSources(v: unknown): HostedSource[] {
  if (!Array.isArray(v)) return [];
  const out: HostedSource[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || !SOURCE_ID.test(o.id)) continue;
    if (typeof o.name !== "string" || !o.name.trim()) continue;
    out.push({
      id: o.id,
      name: o.name.trim().slice(0, 80),
      lang: typeof o.lang === "string" ? o.lang.slice(0, 16) : "",
      icon: typeof o.icon === "string" && /^https:\/\//i.test(o.icon) ? o.icon : undefined,
    });
  }
  return out;
}

function readStored(): HostedSource[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? toHostedSources(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let current: HostedSource[] = readStored() ?? SHIPPED;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** The sources to list: none while signed out of Compass. */
export function hostedSourcesSync(): HostedSource[] {
  return currentAuthor() ? current : [];
}

export function subscribeHostedSources(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// A failed refresh keeps the last known list: the server being down for a moment must not
// empty the manga section.
export async function refreshHostedSources(getKey: KeyGetter = compassKey): Promise<void> {
  let next: HostedSource[];
  try {
    const res = await keyedFetch(`${COMPASS_MANGA_URL}/api/sources`, getKey);
    if (!res.ok) return;
    const body: unknown = await res.json();
    next = toHostedSources((body as { sources?: unknown } | null)?.sources);
  } catch {
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* the in-memory list still applies for this session */
  }
  notify();
}

// Signing in or out (or switching accounts) changes whether hosted sources exist at all and
// whose key they use.
let lastUserId = currentAuthor()?.id ?? null;
subscribeAuthor(() => {
  const id = currentAuthor()?.id ?? null;
  if (id === lastUserId) return;
  lastUserId = id;
  cachedKey = null;
  notify();
  if (id) void refreshHostedSources();
});

// ------------------------------------------------------------------------------- provider

function field(v: unknown, key: string): unknown {
  return v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
}

export function makeHostedProvider(src: HostedSource, getKey: KeyGetter = compassKey): MangaProvider {
  const base = `${COMPASS_MANGA_URL}/api/${src.id}`;

  // A 404 is an answer (no such series or chapter); anything else non-2xx is a failure the
  // caller's retry logic should see.
  async function get(path: string): Promise<unknown> {
    const res = await keyedFetch(base + path, getKey);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`compass manga ${res.status}`);
    return res.json();
  }

  async function popular(offset: number, tagId?: string) {
    const q = new URLSearchParams({ offset: String(offset), limit: String(MANGA_PAGE) });
    if (tagId && SEGMENT.test(tagId)) q.set("tag", tagId);
    return toSummaries(field(await get(`/popular?${q}`), "items"));
  }

  return {
    id: hostedSourceId(src.id),
    name: src.name,
    popular,
    async search(query, offset, tagId) {
      // The browse grid sends an empty query when only a genre is picked.
      if (!query.trim()) return popular(offset, tagId);
      const q = new URLSearchParams({ q: query, offset: String(offset), limit: String(MANGA_PAGE) });
      return toSummaries(field(await get(`/search?${q}`), "items"));
    },
    async detail(id) {
      return SEGMENT.test(id) ? toSummary(await get(`/manga/${id}`)) : null;
    },
    async chapters(id) {
      if (!SEGMENT.test(id)) return [];
      const list = toChapters(field(await get(`/manga/${id}/chapters`), "items"));
      return src.lang ? list.map((c) => ({ ...c, language: src.lang })) : list;
    },
    async pageUrls(chapterId) {
      if (!CHAPTER.test(chapterId)) return [];
      return toStrings(field(await get(`/chapter/${chapterId}/pages`), "pages"));
    },
    async tags() {
      return toTags(field(await get("/tags"), "items"));
    },
  };
}
