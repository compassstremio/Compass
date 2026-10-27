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
const MAX_CANDIDATES = 300;
const HASH_RX = /^[a-f0-9]{40}$/i;
const SEASON_RANGE_RX = /\bS(\d{1,2})\s*-\s*S?(\d{1,2})\b/i;

export const TORBOX_DIRECT_ADDON_ID = "tb-direct";

type Candidate = { hash: string; title: string; size: number; trusted: boolean };

export type TorboxDiscovery = { streams: Stream[]; checked: string[]; cached: string[] };

const EMPTY: TorboxDiscovery = { streams: [], checked: [], cached: [] };

export async function discoverTorboxStreams(
  store: DebridStore,
  query: LibraryQuery,
  signal: AbortSignal,
): Promise<TorboxDiscovery> {
  if (!/^tt\d+$/.test(query.imdbId) || signal.aborted) return EMPTY;
  const settled = await Promise.allSettled([
    fromZilean(query, signal),
    fromKnaben(query, signal),
    fromTorz(query, signal),
  ]);
  const byHash = new Map<string, Candidate>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const c of r.value) {
      if (!fitsQuery(c, query)) continue;
      const prior = byHash.get(c.hash);
      if (!prior || (c.trusted && !prior.trusted)) byHash.set(c.hash, c);
    }
  }
  const candidates = [...byHash.values()]
    .sort((a, b) => Number(b.trusted) - Number(a.trusted))
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0 || signal.aborted) return EMPTY;
  const r = await store.cacheCheck(
    candidates.map((c) => c.hash),
    signal,
  );
  if (!r.ok || signal.aborted) return EMPTY;
  const cached = candidates.filter((c) => r.data[c.hash]);
  dlog(`[torbox-direct] ${candidates.length} candidate(s) → ${cached.length} cached`);
  return {
    streams: cached.map((c) => buildStream(c, query)),
    checked: candidates.map((c) => c.hash),
    cached: cached.map((c) => c.hash),
  };
}

async function getJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url.href, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.json();
}

function episodeTag(q: LibraryQuery): string {
  if (q.season == null || q.episode == null) return "";
  return ` S${String(q.season).padStart(2, "0")}E${String(q.episode).padStart(2, "0")}`;
}

async function fromZilean(q: LibraryQuery, signal: AbortSignal): Promise<Candidate[]> {
  const urls = [true, false].map((byTitle) => {
    const url = new URL(ZILEAN_URL);
    if (byTitle) url.searchParams.set("Query", q.title.replace(/&/g, " and "));
    else url.searchParams.set("ImdbId", q.imdbId);
    if (q.season != null) url.searchParams.set("Season", String(q.season));
    if (q.episode != null) url.searchParams.set("Episode", String(q.episode));
    return url;
  });
  const pages = await Promise.allSettled(urls.map((u) => getJson(u, signal)));
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
  return out;
}

async function fromKnaben(q: LibraryQuery, signal: AbortSignal): Promise<Candidate[]> {
  const url = new URL(KNABEN_URL);
  url.searchParams.set("q", `${q.title}${episodeTag(q)}`);
  url.searchParams.set("c", q.type === "movie" ? "3000000" : "2000000,6000000");
  url.searchParams.set("s", "300");
  url.searchParams.set("o", "seeders");
  url.searchParams.set("dead", "");
  const data = (await getJson(url, signal)) as { hits?: KnabenHit[] };
  if (!Array.isArray(data?.hits)) return [];
  return data.hits
    .filter((h) => HASH_RX.test(h.hash ?? "") && h.title)
    .map((h) => ({
      hash: h.hash!.toLowerCase(),
      title: h.title!,
      size: Number(h.bytes) || 0,
      trusted: false,
    }));
}

async function fromTorz(q: LibraryQuery, signal: AbortSignal): Promise<Candidate[]> {
  const url = new URL(TORZ_URL);
  url.searchParams.set("t", q.type === "movie" ? "movie" : "tvsearch");
  url.searchParams.set("imdbid", q.imdbId.slice(2));
  url.searchParams.set("o", "json");
  url.searchParams.set("limit", "0");
  const data = (await getJson(url, signal)) as { channel?: { items?: TorzItem[] } };
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

function fitsQuery(c: Candidate, q: LibraryQuery): boolean {
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

function buildStream(c: Candidate, q: LibraryQuery): Stream {
  const p = parse(c.title);
  const singleFile = q.type === "movie" || (p.episode != null && p.episode === q.episode);
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
