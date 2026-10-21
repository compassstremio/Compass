import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Meta } from "../src/lib/cinemeta";
import type { PmdbTarget } from "../src/lib/publicmetadb/types";

function load<T>(path: string, mocks: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name: string) => {
      assert.ok(name in mocks, `Unexpected dependency ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports as T;
}

const movie: Meta = { id: "tt123", type: "movie", name: "Fixture" };
const anime: Meta = { id: "mal:123", type: "anime", name: "Fixture anime" };
function harness() {
  let session = { apiKey: "fixture-a" };
  let current = true;
  let existing = false;
  let readFails = false;
  let writeSucceeds = true;
  let known = true;
  let afterResolve = () => {};
  const calls: Array<{ kind: string; target: PmdbTarget }> = [];
  const coordinates: unknown[] = [];
  const watched = new Set<string>();
  const disconnected = { isAuthenticated: () => false, getSession: () => null };
  const history = {
    fetchPmdbWatchedKeySet: async (_target: PmdbTarget, options: any) => {
      assert.equal(options.strict, true);
      options.assertCurrent();
      if (readFails) throw new Error("Fixture history unavailable");
      return watched;
    },
    markPmdbWatched: async (target: PmdbTarget, _at: unknown, options: any) => {
      options.assertCurrent();
      calls.push({ kind: "mark", target });
      return writeSucceeds;
    },
    unmarkPmdbWatched: async (target: PmdbTarget, options: any) => {
      options.assertCurrent();
      calls.push({ kind: "unmark", target });
      return writeSucceeds;
    },
  };
  const providers = load<typeof import("../src/lib/media-provider-actions")>(
    "src/lib/media-provider-actions.ts",
    {
      "./cinemeta": {},
      "./auth": { readActiveStremioAuthKey: () => null },
      "./stremio": { ANIME_CLOUD_ID: /^(kitsu|mal|anilist|anidb):/ },
      "./stremio-item-lock": {},
      "./stremio-watched-sync": {},
      "./trakt/client": {},
      "./trakt/session": disconnected,
      "./trakt/ids": {},
      "./simkl/client": {},
      "./simkl/session": disconnected,
      "./simkl/ids": {},
      "./simkl/list-status": {},
      "./simkl/watchlist": {},
      "./simkl/history": {},
      "./anilist/session": disconnected,
      "./mal/session": disconnected,
      "./publicmetadb/session": { getSession: () => session, isAuthenticated: () => true },
      "./publicmetadb/mappings": { getTmdbForExternal: async () => ({ tmdb_id: 456 }) },
      "./publicmetadb/ids": {
        resolvePmdbTarget: async (_id: string, type: string) => {
          afterResolve();
          return known
            ? { id_type: "imdb", id_value: "tt123", media_type: type === "movie" ? "movie" : "tv" }
            : null;
        },
        resolvePmdbEpisodeTarget: async (_id: string, episode: any) => {
          coordinates.push(episode);
          afterResolve();
          return known
            ? {
                tmdb_id: 456,
                media_type: "tv",
                season: 1,
                episode: episode.absoluteNumber ?? episode.imdbEpisode ?? episode.episode,
              }
            : null;
        },
      },
      "./publicmetadb/history": history,
      "./publicmetadb/watchlist": {
        fetchPmdbWatchlist: async (options: any) => {
          assert.equal(options.strict, true);
          options.assertCurrent();
          if (readFails) throw new Error("Fixture list unavailable");
          return [];
        },
        pmdbWatchlistContains: () => (existing ? { id: "existing" } : null),
        addToPmdbWatchlist: async (target: PmdbTarget, options: any) => {
          options.assertCurrent();
          calls.push({ kind: "add", target });
          return writeSucceeds;
        },
        removeFromPmdbWatchlist: async (target: PmdbTarget, options: any) => {
          options.assertCurrent();
          calls.push({ kind: "remove", target });
          return writeSucceeds;
        },
      },
    },
  );
  return {
    providers,
    calls,
    coordinates,
    watched,
    validate: () => {
      if (!current) throw new Error("Fixture profile changed");
    },
    alreadyListed: () => {
      existing = true;
    },
    failRead: () => {
      readFails = true;
    },
    failWrite: () => {
      writeSucceeds = false;
    },
    unknown: () => {
      known = false;
    },
    swapAccountDuringResolve: () => {
      afterResolve = () => {
        session = { apiKey: "fixture-b" };
      };
    },
    swapProfileDuringResolve: () => {
      afterResolve = () => {
        current = false;
      };
    },
  };
}

test("PMDB Add resolves the title's TMDB identity and remains an add operation", async () => {
  const h = harness();
  await h.providers.watchlistProviderWrites(movie, true)[0].run(h.validate);
  assert.equal(h.calls[0].kind, "add");
  assert.equal(h.calls[0].target.tmdb_id, 456);
  assert.equal(h.calls[0].target.media_type, "movie");
  h.calls.length = 0;
  h.alreadyListed();
  await h.providers.watchlistProviderWrites(movie, true)[0].run(h.validate);
  assert.deepEqual(h.calls, [], "an existing destination never flips add into removal");
});

test("PMDB removal and watched writes require a positive service acknowledgement", async () => {
  const h = harness();
  h.alreadyListed();
  h.failWrite();
  await assert.rejects(
    h.providers.watchlistProviderWrites(movie, false)[0].run(h.validate),
    /did not confirm/,
  );
  await assert.rejects(
    h.providers.watchedProviderWrites(movie, true, { episodes: [] })[0].run(h.validate),
    /did not confirm/,
  );
  assert.deepEqual(
    h.calls.map((call) => call.kind),
    ["remove", "mark"],
  );
});

test("PMDB anime writes preserve absolute numbering without changing the local episode scope", async () => {
  const h = harness();
  const episode = { season: 2, episode: 1, absoluteNumber: 13 };
  await h.providers.watchedProviderWrites(anime, false, { episodes: [episode] })[0].run(h.validate);
  assert.deepEqual(h.coordinates, [episode]);
  assert.deepEqual(h.calls, [
    { kind: "unmark", target: { tmdb_id: 456, media_type: "tv", season: 1, episode: 13 } },
  ]);
});

test("PMDB episode snapshots project resolved numbering back onto the clicked source", async () => {
  const h = harness();
  h.watched.add("1:13");
  const episode = { season: 2, episode: 1, absoluteNumber: 13 };
  assert.deepEqual(
    await h.providers.readPmdbWatched(anime.id, anime.type, [episode], null, h.validate),
    new Set(["2:1"]),
  );
  await h.providers.watchedProviderWrites(anime, true, { episodes: [episode] })[0].run(h.validate);
  assert.deepEqual(h.calls, [], "already watched episodes do not acquire another history entry");
});

test("PMDB cannot turn an unavailable history read or identity into a guessed mutation", async () => {
  const h = harness();
  h.failRead();
  await assert.rejects(
    h.providers.watchedProviderWrites(movie, true, { episodes: [] })[0].run(h.validate),
    /unavailable/,
  );
  assert.deepEqual(h.calls, []);
  const unknown = harness();
  unknown.unknown();
  assert.match(
    (await unknown.providers
      .watchedProviderWrites(anime, false, { episodes: [{ season: 1, episode: 2 }] })[0]
      .run(unknown.validate))!,
    /verified.*mapping/,
  );
  assert.deepEqual(unknown.calls, []);
});

test("PMDB account and Compass profile swaps during preparation cancel writes", async () => {
  for (const accountSwap of [true, false]) {
    const h = harness();
    if (accountSwap) h.swapAccountDuringResolve();
    else h.swapProfileDuringResolve();
    await assert.rejects(
      h.providers.watchlistProviderWrites(movie, true)[0].run(h.validate),
      /changed/,
    );
    assert.deepEqual(h.calls, []);
  }
});

test("strict PMDB history reads reject a failed later page while display reads retain their fallback", async () => {
  let page = 0;
  const api = load<typeof import("../src/lib/publicmetadb/history")>(
    "src/lib/publicmetadb/history.ts",
    {
      "./client": {
        pmdbRequest: async () => {
          if (++page % 2 === 0) throw new Error("Fixture page unavailable");
          return {
            items: [{ id: "one", tmdb_id: 456, media_type: "tv", season: 1, episode: 1 }],
            totalPages: 2,
          };
        },
      },
      "./mappings": {},
      "./session": { isAuthenticated: () => true },
    },
  );
  const target: PmdbTarget = { tmdb_id: 456, media_type: "tv" };
  await assert.rejects(api.fetchPmdbWatchedKeySet(target, { strict: true }), /unavailable/);
  assert.ok((await api.fetchPmdbWatchedKeySet(target)).has("1:1"));
});

test("PMDB mutation guards run after mapping or list preparation and before the write", async () => {
  let current = true;
  const writes: string[] = [];
  const check = () => {
    if (!current) throw new Error("Fixture owner changed");
  };
  const api = load<typeof import("../src/lib/publicmetadb/history")>(
    "src/lib/publicmetadb/history.ts",
    {
      "./client": {
        pmdbRequest: async (path: string) => {
          writes.push(path);
        },
      },
      "./mappings": {
        getTmdbForExternal: async () => {
          current = false;
          return { tmdb_id: 456 };
        },
      },
      "./session": { isAuthenticated: () => true },
    },
  );
  await assert.rejects(
    api.markPmdbWatched({ id_type: "imdb", id_value: "tt123", media_type: "movie" }, undefined, {
      assertCurrent: check,
    }),
    /owner changed/,
  );
  assert.deepEqual(writes, []);
  current = true;
  const lists = load<typeof import("../src/lib/publicmetadb/watchlist")>(
    "src/lib/publicmetadb/watchlist.ts",
    {
      "./client": {
        pmdbRequest: async (path: string, options: any) => {
          if (options.method !== "GET") writes.push(path);
          current = false;
          return { items: [{ id: "fixture-list", type: "watchlist" }] };
        },
      },
      "./session": { isAuthenticated: () => true },
    },
  );
  await assert.rejects(
    lists.addToPmdbWatchlist({ tmdb_id: 456, media_type: "movie" }, { assertCurrent: check }),
    /owner changed/,
  );
  assert.deepEqual(writes, []);
});
