import assert from "node:assert/strict";
import test from "node:test";
import { rpdbPoster, setPosterBaseUrl } from "../src/lib/providers/rpdb.ts";

const BASE = "https://pictorium.compass.sarl";

test("Pictorium requests an IMDb series id as a series", () => {
  setPosterBaseUrl(BASE);
  assert.equal(
    rpdbPoster("", "tt0903747", undefined, undefined, "series"),
    `${BASE}/api/poster/series/tt0903747`,
  );
});

test("Pictorium keeps an IMDb id without a type hint as a movie", () => {
  setPosterBaseUrl(BASE);
  assert.equal(rpdbPoster("", "tt0111161"), `${BASE}/api/poster/movie/tt0111161`);
});

test("Pictorium takes the type from a TMDB id over the hint", () => {
  setPosterBaseUrl(BASE);
  assert.equal(
    rpdbPoster("", "tmdb:tv:1396", undefined, undefined, "movie"),
    `${BASE}/api/poster/series/1396`,
  );
});

test("Pictorium keeps editor options and drops a pasted /api/poster suffix", () => {
  setPosterBaseUrl(`${BASE}/api/poster/movie/tt1?badges=imdb&style=dark`);
  assert.equal(
    rpdbPoster("", "tt0903747", undefined, undefined, "series"),
    `${BASE}/api/poster/series/tt0903747?badges=imdb&style=dark`,
  );
});

test("a {type} template follows the series hint for IMDb ids", () => {
  setPosterBaseUrl("https://posters.example/{type}/{imdbId}.jpg");
  assert.equal(
    rpdbPoster("", "tt0903747", undefined, undefined, "series"),
    "https://posters.example/series/tt0903747.jpg",
  );
});
