import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const HASH = (n: number) => n.toString(16).padStart(40, "0");

const zilean = [
  { info_hash: HASH(1), raw_title: "The Matrix 1999 2160p UHD BluRay", size: 60e9, imdb_id: "tt0133093" },
  { info_hash: HASH(2), raw_title: "The Matrix Reloaded 2003 1080p", size: 9e9, imdb_id: "tt0234215" },
];
const knaben = {
  hits: [
    { hash: HASH(3), title: "The Matrix (1999) 1080p BrRip x264 - YIFY", bytes: 2e9 },
    { hash: HASH(4), title: "The Matrix Resurrections 2021 1080p", bytes: 3e9 },
    { hash: "not-a-hash", title: "The Matrix 1999 720p", bytes: 1e9 },
  ],
};
const torz = {
  channel: {
    items: [
      { guid: HASH(5), title: "The.Matrix.1999.1080p.WEB-DL", attr: [{ "@attributes": { name: "imdb", value: "0133093" } }] },
      { guid: HASH(6), title: "Some Other Film 1999", attr: [{ "@attributes": { name: "imdb", value: "9999999" } }] },
    ],
  },
};

function load(fail: Set<string> = new Set()) {
  const hosts: string[] = [];
  const mocks: Record<string, unknown> = {
    "parse-torrent-title": require("parse-torrent-title"),
    "@/lib/debug": { dlog() {} },
    "@/lib/safe-fetch": {
      safeFetch: async (url: string) => {
        const host = new URL(url).hostname;
        hosts.push(host);
        if (fail.has(host)) return { ok: false, status: 503, json: async () => null };
        const body = host.startsWith("zilean") ? zilean : host === "api.knaben.org" ? knaben : torz;
        return { ok: true, status: 200, json: async () => body };
      },
    },
  };
  const compiled = ts.transpileModule(readFileSync("src/lib/streams/torbox-discovery.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(Object.hasOwn(mocks, id), `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return { discover: exports.discoverTorboxStreams, hosts };
}

function store(cachedHashes: string[]) {
  const asked: string[][] = [];
  return {
    asked,
    slug: "tb",
    cacheCheck: async (hashes: string[]) => {
      asked.push(hashes);
      return { ok: true, data: Object.fromEntries(cachedHashes.filter((h) => hashes.includes(h)).map((h) => [h, true])) };
    },
  };
}

const movie = { type: "movie", imdbId: "tt0133093", title: "The Matrix", year: 1999 };

test("keeps only matching releases and returns only the cached ones", async () => {
  const { discover } = load();
  const s = store([HASH(1), HASH(3)]);
  const r = await discover(s, movie, new AbortController().signal);
  assert.deepEqual(new Set(s.asked[0]), new Set([HASH(1), HASH(3), HASH(5)]));
  assert.deepEqual(r.streams.map((x: any) => x.infoHash).sort(), [HASH(1), HASH(3)]);
  assert.deepEqual(new Set(r.checked), new Set([HASH(1), HASH(3), HASH(5)]));
  assert.equal(r.streams[0].addonId, "tb-direct");
});

test("one failing index does not sink the others", async () => {
  const { discover } = load(new Set(["api.knaben.org", "stremthru.13377001.xyz"]));
  const r = await discover(store([HASH(1)]), movie, new AbortController().signal);
  assert.deepEqual(r.streams.map((x: any) => x.infoHash), [HASH(1)]);
});

test("no IMDb id means no network calls", async () => {
  const { discover, hosts } = load();
  const r = await discover(store([]), { ...movie, imdbId: "" }, new AbortController().signal);
  assert.equal(r.streams.length, 0);
  assert.equal(hosts.length, 0);
});

test("series filter drops other seasons but keeps a covering season range", async () => {
  const { discover } = load();
  const series = { type: "series", imdbId: "tt0903747", title: "Breaking Bad", season: 2, episode: 5 };
  zilean.splice(0, zilean.length,
    { info_hash: HASH(7), raw_title: "Breaking Bad S01-S05 Complete 1080p", size: 1, imdb_id: "tt0903747" },
    { info_hash: HASH(8), raw_title: "Breaking.Bad.S03E05.720p", size: 1, imdb_id: "tt0903747" },
    { info_hash: HASH(9), raw_title: "Breaking.Bad.S02E05.720p", size: 1, imdb_id: "tt0903747" },
  );
  const s = store([HASH(7), HASH(8), HASH(9)]);
  const r = await discover(s, series, new AbortController().signal);
  const got = r.streams.map((x: any) => x.infoHash).sort();
  assert.deepEqual(got, [HASH(7), HASH(9)]);
});
