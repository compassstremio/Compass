import { safeFetch } from "@/lib/safe-fetch";
import { getUiLanguage, subscribe as subscribeUiLanguage } from "@/lib/i18n/store";
import { MANGA_PAGE, type MangaProvider } from "@/lib/manga/types";
import { toChapters, toStrings, toSummaries, toSummary, toTags } from "@/lib/manga/plugins/adapter";

// Sources served by Compass's own manga server (Compass-hosted services/compass-manga-addon).
// Each source is in one language and is offered only to readers whose interface is in that
// language. Reading needs a key: the reader gets it from their account page on the server
// (signing in with Compass) and pastes it into Manga sources. Without a saved, accepted key no
// hosted source is listed. Page images load straight from the source site.

export const COMPASS_MANGA_URL = "https://manga.compass.sarl";
export const COMPASS_MANGA_ACCOUNT_URL = `${COMPASS_MANGA_URL}/account`;

export type HostedSource = { id: string; name: string; lang: string; icon?: string };

/** "missing": nothing saved. "rejected": the server refused the saved key (reset or revoked). */
export type MangaKeyState = "missing" | "saved" | "rejected";

export type SaveKeyResult = "saved" | "malformed" | "rejected" | "unreachable";

const SOURCES_STORAGE = "compass.manga.hosted.v1";
const KEY_STORAGE = "compass.manga.key.v1";

// What the server offered when this build shipped, so a reader with a key has content before
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

const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function subscribeHostedSources(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ------------------------------------------------------------------------------- the key

function readKey(): string | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    return raw && KEY.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

let savedKey: string | null = readKey();
let rejected = false;

export function mangaKeyState(): MangaKeyState {
  if (!savedKey) return "missing";
  return rejected ? "rejected" : "saved";
}

/** The first characters only, for showing which key is saved. */
export function savedKeyPrefix(): string | null {
  return savedKey ? savedKey.slice(0, 8) : null;
}

function writeKey(key: string | null): void {
  savedKey = key;
  rejected = false;
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* kept for this session */
  }
  notify();
}

// Checks the key with the server before keeping it, so a typo is caught at the field instead of
// as a broken manga section.
export async function saveMangaKey(raw: string): Promise<SaveKeyResult> {
  const key = raw.trim();
  if (!KEY.test(key)) return "malformed";
  let res: Response;
  try {
    res = await safeFetch(`${COMPASS_MANGA_URL}/api/key`, { headers: { "X-Compass-Key": key } });
  } catch {
    return "unreachable";
  }
  if (res.status === 401) return "rejected";
  if (!res.ok) return "unreachable";
  writeKey(key);
  void refreshHostedSources();
  return "saved";
}

export function removeMangaKey(): void {
  writeKey(null);
}

/** Resolves the key to send; null when none is saved. Injectable for tests. */
export type KeyGetter = () => string | null;
const currentKey: KeyGetter = () => savedKey;

function markRejected(key: string): void {
  if (savedKey !== key || rejected) return;
  rejected = true;
  notify();
}

async function keyedFetch(url: string, getKey: KeyGetter): Promise<Response> {
  const key = getKey();
  if (!key) throw new Error("add your Compass Manga key in Manga sources");
  const res = await safeFetch(url, { headers: { "X-Compass-Key": key } });
  if (res.status === 401) markRejected(key);
  return res;
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
    const raw = localStorage.getItem(SOURCES_STORAGE);
    return raw ? toHostedSources(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let current: HostedSource[] = readStored() ?? SHIPPED;

// "ar" matches "ar" and "ar-SA"; a source without a language is for everyone.
export function sourcesForLanguage(list: HostedSource[], uiLanguage: string): HostedSource[] {
  const ui = uiLanguage.toLowerCase().split("-")[0];
  return list.filter((s) => !s.lang || s.lang.toLowerCase().split("-")[0] === ui);
}

/** Sources offered in the interface language, whether or not a key is saved yet. */
export function hostedSourcesForLanguage(): HostedSource[] {
  return sourcesForLanguage(current, getUiLanguage());
}

/** The sources to list: those in the interface language, once an accepted key is saved. */
export function hostedSourcesSync(): HostedSource[] {
  return mangaKeyState() === "saved" ? hostedSourcesForLanguage() : [];
}

// The list is open (no key), so it can say which sources fit this reader before they have a
// key. A failed refresh keeps the last known list: the server being down for a moment must not
// empty the manga section.
export async function refreshHostedSources(): Promise<void> {
  let next: HostedSource[];
  try {
    const res = await safeFetch(`${COMPASS_MANGA_URL}/api/sources`);
    if (!res.ok) return;
    const body: unknown = await res.json();
    next = toHostedSources((body as { sources?: unknown } | null)?.sources);
  } catch {
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try {
    localStorage.setItem(SOURCES_STORAGE, JSON.stringify(next));
  } catch {
    /* the in-memory list still applies for this session */
  }
  notify();
}

// A language change can add or remove every hosted source at once.
subscribeUiLanguage(notify);

// ------------------------------------------------------------------------------- provider

function field(v: unknown, key: string): unknown {
  return v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
}

export function makeHostedProvider(src: HostedSource, getKey: KeyGetter = currentKey): MangaProvider {
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
