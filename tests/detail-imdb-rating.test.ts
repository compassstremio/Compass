// @ts-expect-error Node tests are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node tests are outside the browser tsconfig.
import test from "node:test";
import { detailImdbRating, fetchDetailImdbRating } from "../src/lib/detail-imdb-rating";

test("the IMDb badge can fetch a score independently of the title metadata toggle", async () => {
  const calls: unknown[] = [];
  const rating = await fetchDetailImdbRating("tt0111161", "movie", async (...args) => {
    calls.push(args);
    return { imdbRating: "9.3" };
  });
  assert.equal(rating, "9.3");
  assert.deepEqual(calls, [["movie", "tt0111161", true]]);
});

test("a Cinemeta detail rating remains IMDb when the incoming catalog has no rating", () => {
  assert.equal(
    detailImdbRating({
      id: "tt0111161",
      detailId: "tt0111161",
      detail: "9.3",
      detailSource: "imdb",
    }),
    "9.3",
  );
});
test("full Cinemeta metadata restores the badge without a Compass rating service", () => {
  assert.equal(detailImdbRating({ id: "tt1", fullId: "tt1", full: "8.2", compass: null }), "8.2");
});
test("metadata from the previous title cannot supply the current title rating", () => {
  assert.equal(detailImdbRating({ id: "tt2", fullId: "tt1", full: "8.2" }), undefined);
  assert.equal(
    detailImdbRating({ id: "tt2", detailId: "tt1", detail: "8.2", detailSource: "imdb" }),
    undefined,
  );
});
test("a TMDB score must not be presented as an IMDb score", () => {
  assert.equal(
    detailImdbRating({ id: "tmdb:movie:1", detail: "7.8", detailSource: "tmdb" }),
    undefined,
  );
});
test("a service rating wins and inline metadata fills in only when services are unavailable", () => {
  assert.equal(detailImdbRating({ id: "tt1", inline: "8.1", compass: "9.0" }), "9.0");
  assert.equal(detailImdbRating({ id: "tt1", inline: "8.1" }), "8.1");
  assert.equal(detailImdbRating({ id: "tt1", inline: "N/A", cinemeta: "", omdb: "7.9" }), "7.9");
  assert.equal(detailImdbRating({ id: "tt1", inline: 11, compass: 0 }), undefined);
});
