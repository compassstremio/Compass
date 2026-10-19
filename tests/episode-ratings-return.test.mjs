import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { groupEpisodes, episodeNumber, episodeSeason } from "../src/views/detail/episode-groups.ts";

const require = createRequire(import.meta.url);

test("a TMDB outage fallback keeps the season's IMDb ratings on its rows", () => {
  const CinemetaEpisodeRow = () => null;
  const { CinemetaFallback } = load("src/views/detail/series-episodes/cinemeta-fallback.tsx", {
    react: { useMemo: (fn) => fn() },
    "@/lib/i18n": { useT: () => (value) => value },
    "../cinemeta-episodes": { CinemetaEpisodeRow },
  });
  const tree = CinemetaFallback({
    meta: { id: "tt5071412" },
    season: 3,
    videos: [
      { season: 1, episode: 1 },
      { season: 3, episode: 1 },
    ],
    imdbRatings: new Map([["3:1", 8.3]]),
  });
  assert.equal(tree.props.children.length, 1);
  assert.equal(tree.props.children[0].props.imdbRating, 8.3);
});
function load(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(
    (id) => mocks[id] ?? (id === "react/jsx-runtime" ? require(id) : {}),
    exports,
  );
  return exports;
}


function ratingsHarness() {
  const slots = [],
    dependencies = [],
    effects = [];
  let cursor = 0;
  const requests = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, n) => value !== dependencies[index][n])) {
        effects[index]?.();
        effects[index] = callback();
        dependencies[index] = deps;
      }
    },
    useMemo: (callback) => callback(),
  };
  const { useEpisodeImdbRatings } = load("src/views/detail/use-episode-imdb-ratings.ts", {
    react,
    "@/lib/providers/compass-imdb": { compassImdbEpisodes: () => new Promise(() => {}) },
    "@/lib/providers/omdb": {
      omdbSeasonRatings: (key, id, season) =>
        new Promise((resolve) => requests.push({ id, season, resolve })),
    },
  });
  return {
    requests,
    render: (id, season) => {
      cursor = 0;
      return useEpisodeImdbRatings(id, season, "test-key");
    },
  };
}

test("OMDb ratings arrive independently of an unavailable Compass endpoint", async () => {
  const h = ratingsHarness();
  h.render("tt5071412", 3);
  h.requests[0].resolve(
    new Map([
      [1, 8.3],
      [2, 8.5],
      [3, 0],
      [4, 11],
      [5, NaN],
    ]),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    [...h.render("tt5071412", 3)],
    [
      ["3:1", 8.3],
      ["3:2", 8.5],
    ],
  );
});

test("late ratings cannot leak into another title or season", async () => {
  const h = ratingsHarness();
  h.render("tt5071412", 3);
  h.render("tt0903747", 1);
  h.requests[0].resolve(new Map([[1, 9]]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.render("tt0903747", 1).size, 0);
  h.requests[1].resolve(new Map([[1, 8.2]]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.render("tt0903747", 1).get("1:1"), 8.2);
  assert.equal(h.render("tt0903747", 2).size, 0);
});

test("Cinemeta episode grids receive genuine episode IMDb badges", () => {
  const EpisodeGrid = () => null;
  const { CinemetaEpisodes } = load("src/views/detail/cinemeta-episodes.tsx", {
    react: {
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useSyncExternalStore: () => 0,
    },
    "@/lib/settings": {
      useSettings: () => ({
        settings: { episodeLayout: "grid", showEpisodeRating: true, omdbKey: "test-key" },
        update: () => {},
      }),
    },
    "@/lib/i18n": { useT: () => (value) => value },
    "@/lib/manual-watched": {
      manualEpisodeKeys: () => ({ watched: new Set(), unwatched: new Set() }),
    },
    "@/lib/local-library/use-series-play": { useLocalAwareSeriesPlay: () => () => {} },
    "@/lib/episode-progress": { resumeDefaultSeason: () => 3 },
    "@/lib/season-view-pref": { getViewedSeason: () => undefined, setViewedSeason: () => {} },
    "./episode-groups": { groupEpisodes, episodeNumber, episodeSeason },
    "./helpers": { isUpcomingDate: () => false },
    "./episode-grid": { EpisodeGrid },
    "./use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map([["3:1", 8.3]]) },
  });
  const tree = CinemetaEpisodes({
    meta: { id: "tt5071412" },
    videos: [
      { season: 1, episode: 1 },
      { season: 3, episode: 1, name: "Wartime" },
    ],
  });
  function find(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === EpisodeGrid) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child);
      if (result) return result;
    }
  }
  const cards = find(tree).props.episodes;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].season, 3);
  assert.equal(cards[0].rating, 8.3);
  assert.equal(cards[0].ratingIsImdb, true);
});
