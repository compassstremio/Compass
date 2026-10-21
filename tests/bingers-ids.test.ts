import assert from "node:assert/strict";
import test from "node:test";
import { resolveBingersTarget } from "../src/lib/bingers/ids.ts";

test("an IMDb movie resolves to its title", () => {
  assert.deepEqual(resolveBingersTarget({ metaId: "tt1375666", metaType: "movie" }), {
    title: "imdb:tt1375666",
  });
});

test("an IMDb episode resolves from the playing episode or the id itself", () => {
  const episode = { season: 1, episode: 2 };
  assert.deepEqual(resolveBingersTarget({ metaId: "tt0903747", metaType: "series", episode }), {
    title: "imdb:tt0903747",
    season: 1,
    episode: 2,
  });
  assert.deepEqual(resolveBingersTarget({ metaId: "tt0903747:3:4", metaType: "series" }), {
    title: "imdb:tt0903747",
    season: 3,
    episode: 4,
  });
});

test("a series without an episode never names the whole show", () => {
  assert.equal(resolveBingersTarget({ metaId: "tt0903747", metaType: "series" }), null);
  assert.equal(resolveBingersTarget({ metaId: "tmdb:tv:1396", metaType: "series" }), null);
  assert.equal(resolveBingersTarget({ metaId: "tvdb:81189", metaType: "series" }), null);
});

test("TMDB ids carry their kind so Bingers never has to guess", () => {
  assert.deepEqual(resolveBingersTarget({ metaId: "tmdb:movie:550" }), { title: "tmdb:movie:550" });
  assert.deepEqual(
    resolveBingersTarget({ metaId: "tmdb:tv:1396", episode: { season: 2, episode: 5 } }),
    { title: "tmdb:show:1396", season: 2, episode: 5 },
  );
  assert.deepEqual(resolveBingersTarget({ metaId: "tmdb:550", metaType: "movie" }), {
    title: "tmdb:movie:550",
  });
  assert.equal(resolveBingersTarget({ metaId: "tmdb:person:287" }), null);
});

test("TVDB series episodes resolve against the show", () => {
  assert.deepEqual(
    resolveBingersTarget({ metaId: "tvdb:81189", episode: { season: 1, episode: 2 } }),
    { title: "tvdb:81189", season: 1, episode: 2 },
  );
});

test("anime prefers the TVDB episode id, then IMDb's own mapping", () => {
  assert.deepEqual(
    resolveBingersTarget({
      metaId: "kitsu:1376",
      episode: { season: 1, episode: 30, tvdbEpisodeId: 4185563 },
    }),
    { tvdb_episode: "4185563" },
  );
  assert.deepEqual(
    resolveBingersTarget({
      metaId: "kitsu:1376",
      episode: { season: 1, episode: 30, imdbId: "tt0877057", imdbSeason: 2, imdbEpisode: 4 },
    }),
    { title: "imdb:tt0877057", season: 2, episode: 4 },
  );
});

test("anime absolute numbering is never sent as a season and episode", () => {
  assert.equal(
    resolveBingersTarget({
      metaId: "kitsu:1376",
      imdbId: "tt0877057",
      episode: { season: 1, episode: 30 },
    }),
    null,
  );
});

test("an addon id falls back to the IMDb id the player resolved", () => {
  assert.deepEqual(
    resolveBingersTarget({ metaId: "someaddon:abc", metaType: "movie", imdbId: "tt0111161" }),
    { title: "imdb:tt0111161" },
  );
  assert.deepEqual(
    resolveBingersTarget({
      metaId: "someaddon:abc",
      metaType: "series",
      imdbId: "tt0903747",
      episode: { season: 1, episode: 1 },
    }),
    { title: "imdb:tt0903747", season: 1, episode: 1 },
  );
  assert.equal(resolveBingersTarget({ metaId: "someaddon:abc", metaType: "movie" }), null);
});

test("malformed ids and numbers resolve to nothing", () => {
  assert.equal(resolveBingersTarget({ metaId: "" }), null);
  assert.equal(resolveBingersTarget({ metaId: "tt12x" }), null);
  assert.equal(
    resolveBingersTarget({ metaId: "tt0903747", episode: { season: -1, episode: 2 } }),
    null,
  );
  assert.equal(
    resolveBingersTarget({ metaId: "tt0903747", episode: { season: 1.5, episode: 2 } }),
    null,
  );
});
