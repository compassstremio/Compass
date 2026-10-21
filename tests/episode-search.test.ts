// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  episodeSearchVideos,
  matchingEpisodeVideos,
  specificEpisodeTitle,
} from "../src/lib/episode-search";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const trumpEpisode = {
  id: 4301,
  seasonNumber: 43,
  episodeNumber: 1,
  name: "Trump's Comeback",
  overview: "A report on the election.",
  stillPath: null,
  airDate: "2025-01-01",
  runtime: 60,
  voteAverage: null,
};

test("search finds the displayed TMDB episode without Cinemeta videos", () => {
  const videos = episodeSearchVideos(undefined, [], [trumpEpisode]);
  assert.deepEqual(
    matchingEpisodeVideos(videos, "trump").map((video) => video.name),
    ["Trump's Comeback"],
  );
});

test("generic numbered labels do not hide a real episode title", () => {
  assert.equal(specificEpisodeTitle("Episode 01", 1), undefined);
  assert.equal(specificEpisodeTitle("The Pilot", 1), "The Pilot");
});

test("search includes fetched seasons and episode descriptions", () => {
  const videos = episodeSearchVideos(
    undefined,
    [
      {
        ...trumpEpisode,
        seasonNumber: 12,
        episodeNumber: 3,
        name: "A Different Title",
        overview: "Trump's first campaign.",
      },
    ],
    [trumpEpisode],
  );
  assert.deepEqual(
    matchingEpisodeVideos(videos, "trump").map((video) => `${video.season}:${video.episode}`),
    ["12:3", "43:1"],
  );
});

test("displayed title takes priority over an older Cinemeta title", () => {
  const videos = episodeSearchVideos(
    [{ id: "tt123:43:1", season: 43, episode: 1, name: "Episode 1" }],
    [],
    [trumpEpisode],
  );
  assert.equal(videos[0]?.name, "Trump's Comeback");
  assert.equal(videos[0]?.id, "tt123:43:1");
});

test("the catalog indexes the title the grid would show for that season", () => {
  const source = read("src/views/detail/series-episodes.tsx");
  const start = source.indexOf("const searchVideos");
  const catalog = source.slice(start, source.indexOf("const hiddenSet", start));
  // The episode list picks a preferred-language name; a catalog built from the raw
  // TMDB string would not match what the user can see and type.
  assert.match(catalog, /pickPreferredEpisodeTitle\(/);
  assert.match(catalog, /pickPreferredEpisodeOverview\(/);
  assert.match(catalog, /metadataLanguage/);
});

test("closing the search mid-load cannot leave the catalog loading", () => {
  const source = read("src/views/detail/series-episodes.tsx");
  const start = source.indexOf("const wantsCatalog");
  assert.ok(start > 0, "the search effect must decide whether a catalog is wanted");
  const guard = source.slice(start, source.indexOf("return;", start));
  // Leaving the flag raised disables AI search on the next visit, with nothing
  // left running to clear it.
  assert.match(guard, /setSearchLoading\(false\)/);
});
