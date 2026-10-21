import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildStreamIds, preferredAnimeImdbStreamId, unverifiedAnimeSeasonId } from "../src/lib/streams/stream-ids.ts";
import { animeAbsoluteFromScopedId } from "../src/lib/streams/anime-identity-core.ts";
import { lruSet } from "../src/lib/cache.ts";

function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "window", "localStorage", code)((id) => {
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports, {}, { length: 0 });
  return exports;
}

const pluginMocks = {
  PLUGIN_ADDON_PREFIX: "compass-plugin://",
  isPluginAddon: (addon) => addon.transportUrl.startsWith("compass-plugin://"),
  pluginIdFromCatalogueBase: (base) => base.startsWith("compass-plugin://") ? base.slice(16) : undefined,
  pluginAddonById: () => undefined,
  pluginsForAddon: () => [],
};

const { buildEpisodePipelineInput } = load("../src/lib/streams/episode-pipeline-input.ts", {
  "@/lib/addons": { addonBasesForOrigin: (_, origin) => origin ? ["https://native.example"] : [] },
  "@/lib/cinemeta": { isAddonNativeMeta: (meta) => meta.id.startsWith("native:") },
  "@/lib/playback-history": { readPlayback: () => null },
  "./addon-priority": { resolveAddonRanks: () => null },
  "./anime-identity-core": { animeAbsoluteFromScopedId },
  "./plugins/addon": pluginMocks,
  "./stream-ids": { preferredAnimeImdbStreamId, unverifiedAnimeSeasonId },
});

function input({ enabled = true, id = "kitsu:123", episode, imdbId = "tt1234567", verified = true, ids, origin } = {}) {
  return buildEpisodePipelineInput({
    meta: { id, name: "Fixture Anime", type: episode ? "series" : "movie", addonOrigin: origin },
    episode, imdbId, imdbIdVerified: verified,
    streamIds: ids ?? buildStreamIds(id, episode, imdbId),
    addons: [], debrids: [], strictMode: true, filterDisabled: false,
    settings: { animePreferImdbStreams: enabled, addonTimeoutSec: 30, preferredLanguages: [], bandwidthMbps: 0 },
  });
}

function addon(prefixes = ["kitsu", "tt"], types = ["movie", "series"]) {
  return { transportUrl: "https://addon.example/manifest.json", manifest: {
    id: "fixture", name: "Fixture", types,
    resources: [{ name: "stream", types, idPrefixes: prefixes }],
  } };
}

function transport(empty = false) {
  const urls = [];
  const plugins = [];
  const fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ streams: empty ? [] : [{ url: "https://video.example/fixture.mp4" }] }) };
  };
  const api = load("../src/lib/streams/addons.ts", {
    "@/lib/safe-fetch": { safeFetch: fetch, safeFetchLocal: fetch },
    "@/lib/debug": { dlog() {}, dwarn() {} },
    "@/lib/fetch-fallback-policy": { isCompassFetchPolicyError: () => false },
    "@/lib/local-network": { isLocalNetworkUrl: () => false },
    "./addon-detect": {
      isAddonRanked: () => false, isRetiredTorboxAddon: () => false,
      isStatusOnlyAddon: () => false, isStremioLocalAddon: () => false,
    },
    "./cached": { hasUncachedMarker: () => false },
    "@/lib/torrent/magnet": {},
    "./plugins/addon": { ...pluginMocks, runPluginAddon: async (_, req, id) => { plugins.push({ req, id }); return []; } },
  });
  return { urls, plugins, api, async run(req, source = addon(), forced) {
    await api.fetchAddonStreams([source], req, new AbortController().signal, undefined, undefined, 1000, undefined, forced);
    return urls.map((url) => /\/stream\/[^/]+\/(.+)\.json$/.exec(url)[1]);
  } };
}

const mapped = { season: 1, episode: 1, imdbId: "tt1234567", imdbSeason: 2, imdbEpisode: 13, kitsuStreamId: "kitsu:123:1" };

test("off keeps Kitsu selection; on sends the mapped IMDb episode to the addon", async () => {
  assert.deepEqual(await transport().run(input({ episode: mapped, enabled: false }).request), ["kitsu:123:1"]);
  const enabled = input({ episode: mapped });
  assert.deepEqual(await transport().run(enabled.request), ["tt1234567:2:13"]);
  assert.ok(enabled.request.ids.includes("kitsu:123:1"));
  assert.equal(enabled.isAnime, true);
  assert.equal(enabled.animeAbsoluteEpisode, 1);
  assert.equal(enabled.trust.expectedEpisode, 1);
  assert.ok(enabled.animeEpisodeAliases.has(13));
});

test("all native anime schemes can prefer a verified movie ID", async () => {
  for (const scheme of ["kitsu", "mal", "anilist", "anidb"]) {
    const request = input({ id: `${scheme}:123` }).request;
    assert.equal(request.preferredAnimeImdbId, "tt1234567");
    assert.deepEqual(await transport().run(request, addon([scheme, "tt"])), ["tt1234567"]);
  }
});

test("missing or unverified mappings retain anime lookup without guessing display coordinates", async () => {
  for (const options of [
    { episode: { season: 1, episode: 1 } },
    { episode: { season: 1, episode: 1, imdbSeason: 2 } },
    { episode: { season: 1, episode: 1, imdbSeason: -1, imdbEpisode: 13 } },
    { verified: false },
    { imdbId: null },
    { imdbId: "tt-invalid" },
  ]) {
    const req = input(options).request;
    assert.equal(req.preferredAnimeImdbId, undefined);
    assert.ok((await transport().run(req))[0].startsWith("kitsu:"));
  }
});

test("an explicit episode IMDb mapping wins over a different or unverified series ID", async () => {
  const req = input({ episode: mapped, imdbId: "tt9999999", verified: false }).request;
  assert.deepEqual(await transport().run(req), ["tt1234567:2:13"]);
});

test("an anime mapping resolved from a TMDB page can prefer IMDb", async () => {
  const req = input({ id: "tmdb:tv:123", episode: mapped }).request;
  assert.deepEqual(await transport().run(req), ["tt1234567:2:13"]);
});

test("addon prefix restrictions retain supported anime IDs", async () => {
  assert.deepEqual(await transport().run(input({ episode: mapped }).request, addon(["kitsu"])), ["kitsu:123:1"]);
});

test("an unverified anime candidate still uses IMDb with the preference off", async () => {
  const req = input({
    episode: { season: 4, episode: 9, imdbSeason: 4, imdbEpisode: 9 }, enabled: false,
  }).request;
  assert.equal(req.animeIdUnverified, true);
  assert.deepEqual(await transport().run(req), ["tt1234567:4:9"]);
});

test("specials retain both identities when the addon supports both", async () => {
  const episode = { ...mapped, imdbSeason: 0, imdbEpisode: 2 };
  assert.deepEqual(await transport().run(input({ episode }).request), ["tt1234567:0:2", "kitsu:123:1"]);
  assert.deepEqual(await transport().run(input({ episode, enabled: false }).request), ["kitsu:123:1", "tt1234567:0:2"]);
});

test("empty IMDb results do not add a second lookup", async () => {
  assert.deepEqual(await transport(true).run(input({ episode: mapped }).request), ["tt1234567:2:13"]);
});

test("non-anime requests are identical with the option on or off", async () => {
  for (const [id, episode] of [["tmdb:movie:123", undefined], ["tt1234567", { season: 2, episode: 3 }]]) {
    const enabled = input({ id, episode, enabled: true });
    const disabled = input({ id, episode, enabled: false });
    assert.deepEqual(enabled, disabled);
    assert.deepEqual(await transport().run(enabled.request, addon(["tt", "tmdb:"])), await transport().run(disabled.request, addon(["tt", "tmdb:"])));
  }
});

test("alternate declared types honor the preference", async () => {
  const h = transport();
  await h.run(input({ episode: mapped }).request, addon(["kitsu", "tt"], ["anime"]));
  assert.deepEqual(h.urls, ["https://addon.example/stream/anime/tt1234567:2:13.json"]);
});

test("forced native addon IDs and pinned plugins retain their lookup contract", async () => {
  const req = input({ episode: mapped }).request;
  assert.deepEqual(await transport().run(req, addon(), [{ base: "https://addon.example", id: "native:page" }]), ["native:page"]);
  const h = transport();
  const plugin = { ...addon(), transportUrl: "compass-plugin://fixture" };
  assert.equal(h.api.pluginQueryId(plugin, req, "capstan:fixture:page:1:1"), "capstan:fixture:page:1:1");
  assert.equal(h.api.pluginQueryId(plugin, req, undefined), "tt1234567:2:13");
  assert.equal(input({ id: "native:page", episode: mapped, ids: req.ids }).request.preferredAnimeImdbId, undefined);
});

test("plugins receive the preferred provider coordinates instead of cour display coordinates", async () => {
  const { buildPluginRequest } = load("../src/lib/streams/plugins/request.ts", {
    "@/lib/cinemeta": { meta: async () => null },
    "@/lib/providers/tmdb/tmdb-imdb-resolve": { tmdbIdFromImdb: async () => null },
    "./extension/detail": { parseCapstanId: () => null },
    "./source": { settingsValuesFor: () => ({}) },
  });
  const req = input({ episode: mapped }).request;
  req.context.imdbId = "tt9999999";
  req.ids.push("tmdb:tv:123");
  const result = await buildPluginRequest(req, req.preferredAnimeImdbId, {}, undefined);
  assert.equal(result.imdbId, "tt1234567");
  assert.equal(result.season, 2);
  assert.equal(result.episode, 13);
  assert.equal(result.absoluteEpisode, 1);
  const native = await buildPluginRequest(req, "capstan:fixture:page", {}, undefined);
  assert.equal(native.season, 1);
  assert.equal(native.episode, 1);
});

test("cache keys change with the anime preference and resolved mapping, with no change for non-anime", () => {
  const api = load("../src/lib/picker-cache.ts", {
    "./cache": { lruSet }, "./maintenance": { registerEvictable() {} },
  });
  const config = { addonTransportUrls: [], debridSlugs: [], scraperKeys: [], filterMode: "strict" };
  const off = api.buildPickerConfigHash({ ...config, animePreferImdbStreams: false });
  const waiting = api.buildPickerConfigHash({ ...config, animePreferImdbStreams: true });
  const on = api.buildPickerConfigHash({ ...config, animePreferImdbStreams: true, preferredAnimeImdbId: "tt1234567:2:13" });
  assert.notEqual(off, on);
  assert.notEqual(waiting, on);
  assert.equal(api.buildPickerConfigHash(config), api.buildPickerConfigHash({ ...config, animePreferImdbStreams: undefined }));
  const meta = { id: "kitsu:123" };
  const result = { picker: { all: [{ url: "fixture" }] }, rejected: [] };
  api.setPickerCache(meta, mapped, result, off, true, false);
  assert.equal(api.peekPickerCache(meta, mapped, true), null);
  assert.ok(api.peekPickerCache(meta, mapped, false));
  assert.equal(api.getPickerCache(meta, mapped, on), null);
  api.setPickerCache(meta, mapped, result, on, true, true);
  assert.ok(api.getPickerCache(meta, mapped, on));
  assert.equal(api.peekPickerCache(meta, mapped, false), null);
  const regular = { id: "tt9999999" };
  api.setPickerCache(regular, undefined, result, api.buildPickerConfigHash(config));
  assert.ok(api.peekPickerCache(regular, undefined, true));
  assert.ok(api.peekPickerCache(regular, undefined, false));
});
