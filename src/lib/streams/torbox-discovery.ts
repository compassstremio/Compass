import { parse } from "parse-torrent-title";
import { safeFetch as fetch } from "@/lib/safe-fetch";
import { dlog } from "@/lib/debug";
import type { DebridStore } from "@/lib/debrid/types";
import type { LibraryQuery } from "./library";
import type { Stream } from "./types";

/**
 * Finds TorBox-cached releases without a scraper addon: public hash indexes (Zilean/DMM,
 * Knaben, Torz Torznab) supply candidate hashes for the IMDb ID, then the user's own
 * TorBox client keeps only the cached ones. None of these hosts ever sees the TorBox key.
 */
const ZILEAN_URL = "https://zileanfortheweebs.midnightignite.me/dmm/filtered";
const KNABEN_URL = "https://api.knaben.org/v2/search";
const TORZ_URL = "https://stremthru.13377001.xyz/v0/torznab/api";
const SOURCE_TIMEOUT_MS = 6500;
// A safety bound, not a relevance cut: cache checks are batched POSTs.
const MAX_CANDIDATES = 3000;
// Each Zilean query returns a capped page, so splitting by resolution surfaces 4K releases.
const ZILEAN_RESOLUTIONS = [undefined, "2160p", "1080p", "720p"] as const;
// Candidate lists come from public indexes only; availability is re-checked on every call.
const CANDIDATE_TTL_MS = 10 * 60_000;
const EMPTY_TTL_MS = 60_000;
const CANDIDATE_CACHE_MAX = 64;
const HASH_RX = /^[a-f0-9]{40}$/i;
const SEASON_RANGE_RX = /\bS(\d{1,2})\s*-\s*S?(\d{1,2})\b/i;
const ANIME_RELEASE_RX = /^\s*(?:\[[^\]]*\]\s*)?(.+?)\s+-\s+(\d{1,4})(?:v\d)?(?=\s*[[(.]|\s*$)/;

export const TORBOX_DIRECT_ADDON_ID = "tb-direct";

type Candidate = { hash: string; title: string; size: number; trusted: boolean };

export type TorboxDiscovery = { streams: Stream[]; checked: string[]; cached: string[] };

export type TorboxDiscoveryOptions = { absoluteEpisode?: number | null };

const EMPTY: TorboxDiscovery = { streams: [], checked: [], cached: [] };

const candidateCache = new Map<string, { at: number; ttl: number; pending: Promise<Candidate[]> }>();

export async function discoverTorboxStreams(
  store: DebridStore,
  query: LibraryQuery,
  signal: AbortSignal,
  opts: TorboxDiscoveryOptions = {},
): Promise<TorboxDiscovery> {
  if (!/^tt\d+$/.test(query.imdbId) || signal.aborted) return EMPTY;
  const absolute = opts.absoluteEpisode ?? undefined;
  const candidates = await abortable(candidatesFor(query, absolute), signal).catch(() => []);
  if (candidates.length === 0 || signal.aborted) return EMPTY;
  const r = await store.cacheCheck(
    candidates.map((c) => c.hash),
    signal,
  );
  if (!r.ok || signal.aborted) return EMPTY;
  const cached = candidates.filter((c) => r.data[c.hash]);
  dlog(`[torbox-direct] ${candidates.length} candidate(s) → ${cached.length} cached`);
  return {
    streams: cached.map((c) => buildStream(c, query, absolute)),
    checked: candidates.map((c) => c.hash),
    cached: cached.map((c) => c.hash),
  };
}

// Shared across callers and not tied to one caller's signal, so reopening a title
// (or a second picker racing the first) reuses the same index lookups.
function candidatesFor(query: LibraryQuery, absolute: number | undefined): Promise<Candidate[]> {
  const key = [query.type, query.imdbId, query.season, query.episode, absolute].join(":");
  const hit = candidateCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.pending;
  const entry = { at: Date.now(), ttl: CANDIDATE_TTL_MS, pending: loadCandidates(query, absolute) };
  candidateCache.set(key, entry);
  while (candidateCache.size > CANDIDATE_CACHE_MAX) {
    candidateCache.delete(candidateCache.keys().next().value!);
  }
  entry.pending.then(
    (list) => {
      if (list.length === 0) entry.ttl = EMPTY_TTL_MS;
    },
    () => {
      if (candidateCache.get(key) === entry) candidateCache.delete(key);
    },
  );
  return entry.pending;
}

async function loadCandidates(query: LibraryQuery, absolute: number | undefined): Promise<Candidate[]> {
  const settled = await Promise.allSettled([
    fromZilean(query),
    fromKnaben(query, absolute),
    fromTorz(query),
  ]);
  const byHash = new Map<string, Candidate>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const c of r.value) {
      if (!fitsQuery(c, query, absolute)) continue;
      const prior = byHash.get(c.hash);
      if (!prior || (c.trusted && !prior.trusted)) byHash.set(c.hash, c);
    }
  }
  return [...byHash.values()]
    .sort((a, b) => Number(b.trusted) - Number(a.trusted))
    .slice(0, MAX_CANDIDATES);
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function getJson(url: URL): Promise<unknown> {
  const res = await fetch(url.href, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.json();
}

function episodeTag(q: LibraryQuery): string {
  if (q.season == null || q.episode == null) return "";
  return ` S${String(q.season).padStart(2, "0")}E${String(q.episode).padStart(2, "0")}`;
}

async function fromZilean(q: LibraryQuery): Promise<Candidate[]> {
  const urls = [true, false].flatMap((byTitle) =>
    ZILEAN_RESOLUTIONS.map((resolution) => {
      const url = new URL(ZILEAN_URL);
      if (byTitle) url.searchParams.set("Query", q.title.replace(/&/g, " and "));
      else url.searchParams.set("ImdbId", q.imdbId);
      // The unfiltered query also covers season packs that carry no episode tag.
      if (resolution) {
        url.searchParams.set("Resolution", resolution);
        if (q.season != null) url.searchParams.set("Season", String(q.season));
        if (q.episode != null) url.searchParams.set("Episode", String(q.episode));
      }
      return url;
    }),
  );
  const pages = await Promise.allSettled(urls.map((u) => getJson(u)));
  const out: Candidate[] = [];
  for (const p of pages) {
    if (p.status !== "fulfilled" || !Array.isArray(p.value)) continue;
    for (const x of p.value as ZileanRow[]) {
      if (!HASH_RX.test(x.info_hash ?? "") || !x.raw_title) continue;
      if (x.imdb_id && x.imdb_id !== q.imdbId) continue;
      out.push({
        hash: x.info_hash!.toLowerCase(),
        title: x.raw_title,
        size: Number(x.size) || 0,
        trusted: x.imdb_id === q.imdbId,
      });
    }
  }
  if (pages.every((p) => p.status === "rejected")) throw new Error("zilean-unavailable");
  return out;
}

async function fromKnaben(q: LibraryQuery, absolute: number | undefined): Promise<Candidate[]> {
  const terms =
    q.type === "movie"
      ? [q.title, `${q.title} 2160p`]
      : [`${q.title}${episodeTag(q)}`, ...(absolute != null ? [`${q.title} ${absolute}`] : [])];
  const pages = await Promise.allSettled(
    terms.map((term) => {
      const url = new URL(KNABEN_URL);
      url.searchParams.set("q", term);
      url.searchParams.set("c", q.type === "movie" ? "3000000" : "2000000,6000000");
      url.searchParams.set("s", "300");
      url.searchParams.set("o", "seeders");
      url.searchParams.set("dead", "");
      return getJson(url) as Promise<{ hits?: KnabenHit[] }>;
    }),
  );
  if (pages.every((p) => p.status === "rejected")) throw new Error("knaben-unavailable");
  return pages.flatMap((p) =>
    p.status === "fulfilled" && Array.isArray(p.value?.hits)
      ? p.value.hits
          .filter((h) => HASH_RX.test(h.hash ?? "") && h.title)
          .map((h) => ({
            hash: h.hash!.toLowerCase(),
            title: h.title!,
            size: Number(h.bytes) || 0,
            trusted: false,
          }))
      : [],
  );
}

async function fromTorz(q: LibraryQuery): Promise<Candidate[]> {
  const url = new URL(TORZ_URL);
  url.searchParams.set("t", q.type === "movie" ? "movie" : "tvsearch");
  url.searchParams.set("imdbid", q.imdbId.slice(2));
  url.searchParams.set("o", "json");
  url.searchParams.set("limit", "0");
  const data = (await getJson(url)) as { channel?: { items?: TorzItem[] } };
  const items = data?.channel?.items;
  if (!Array.isArray(items)) return [];
  const out: Candidate[] = [];
  for (const item of items) {
    const attrs: Record<string, string | undefined> = {};
    for (const a of item.attr ?? []) {
      const name = a["@attributes"]?.name;
      if (name) attrs[name] = a["@attributes"]?.value;
    }
    const hash = attrs.infohash ?? item.guid ?? "";
    if (!HASH_RX.test(hash) || !item.title) continue;
    const id = (attrs.imdb ?? "").replace(/^tt/, "");
    if (id && id !== q.imdbId.slice(2)) continue;
    out.push({
      hash: hash.toLowerCase(),
      title: item.title,
      size: Number(attrs.size) || 0,
      trusted: id === q.imdbId.slice(2),
    });
  }
  return out;
}

function fitsQuery(c: Candidate, q: LibraryQuery, absolute: number | undefined): boolean {
  // "[Group] Title - 1050 (1080p)": the parser reads neither the title nor the number.
  const anime = absolute != null ? ANIME_RELEASE_RX.exec(c.title) : null;
  if (anime) {
    const n = Number(anime[2]);
    if (n !== absolute && n !== q.episode) return false;
    return c.trusted || normalize(anime[1]) === normalize(q.title);
  }
  const p = parse(c.title);
  if (q.type === "movie" && q.year != null && p.year != null && Math.abs(p.year - q.year) > 1) {
    return false;
  }
  if (q.type === "series" && q.season != null && p.season != null && p.season !== q.season) {
    const range = SEASON_RANGE_RX.exec(c.title);
    if (!range || q.season < Number(range[1]) || q.season > Number(range[2])) return false;
  }
  if (q.type === "series" && q.episode != null && p.episode != null && p.episode !== q.episode) {
    return false;
  }
  if (c.trusted) return true;
  const a = normalize(q.title);
  return a.length >= 2 && a === normalize(p.title ?? c.title);
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function buildStream(c: Candidate, q: LibraryQuery, absolute: number | undefined): Stream {
  const p = parse(c.title);
  const singleFile =
    q.type === "movie" ||
    (p.episode != null && p.episode === q.episode) ||
    (absolute != null && ANIME_RELEASE_RX.test(c.title));
  return {
    name: c.title,
    title: "[TB⚡] TorBox Direct",
    infoHash: c.hash,
    behaviorHints: singleFile && c.size > 0 ? { videoSize: c.size } : undefined,
    addonId: TORBOX_DIRECT_ADDON_ID,
    addonName: "TorBox Direct",
  };
}

type ZileanRow = { info_hash?: string; raw_title?: string; size?: string | number; imdb_id?: string };
type KnabenHit = { hash?: string; title?: string; bytes?: number };
type TorzItem = {
  guid?: string;
  title?: string;
  attr?: Array<{ "@attributes"?: { name?: string; value?: string } }>;
};
