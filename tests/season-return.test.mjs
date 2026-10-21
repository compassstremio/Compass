import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { getViewedSeason, setViewedSeason } from "../src/lib/season-view-pref.ts";
import { groupEpisodes, episodeNumber, episodeSeason } from "../src/views/detail/episode-groups.ts";
const require = createRequire(import.meta.url);
function load(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll(
    "import.meta.env",
    "({ DEV: false })",
  );
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

test("returning to Ozark restores season 3 and validates the available seasons", () => {
  const seasons = [1, 2, 3, 4].map((seasonNumber) => ({ seasonNumber }));
  setViewedSeason("tt5071412", 3);
  assert.equal(getViewedSeason("tt5071412", seasons), 3);
  assert.equal(getViewedSeason("another-show", seasons), undefined);
  assert.equal(getViewedSeason("tt5071412", [{ seasonNumber: 1 }]), undefined);
  setViewedSeason("specials-show", 0);
  assert.equal(getViewedSeason("specials-show", [{ seasonNumber: 0 }, { seasonNumber: 1 }]), 0);
});

test("Cinemeta episode grids restore the saved season after recreation", () => {
  const EpisodeGrid = () => null;
  const { CinemetaEpisodes } = load("src/views/detail/cinemeta-episodes.tsx", {
    react: {
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useSyncExternalStore: () => 0,
    },
    "@/lib/season-view-pref": { getViewedSeason, setViewedSeason },
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
    "@/lib/episode-progress": { resumeDefaultSeason: () => 1 },
    "./episode-groups": { groupEpisodes, episodeNumber, episodeSeason },
    "./helpers": { isUpcomingDate: () => false },
    "./episode-grid": { EpisodeGrid },
    "./use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map([["3:1", 8.3]]) },
  });
  setViewedSeason("tt5071412", 3);
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
});

test("TMDB season picker restores and persists selections across detail recreation", () => {
  const SeasonArcPicker = () => null;
  const pmdbWatched = new Set(["1:1"]);
  const react = {
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: () => 0,
  };
  const mocks = {
    react,
    "@/lib/season-view-pref": { getViewedSeason, setViewedSeason },
    "@/lib/settings": {
      useSettings: () => ({
        settings: {
          aiSearchModel: "",
          aiSearchKey: "",
          aiGroqKey: "",
          episodeLayout: "grid",
          episodeSort: "airDate",
          episodeHiding: false,
          episodeArcGroups: false,
          preferCustomMetaAddon: false,
          tmdbKey: "test-key",
          tvdbKey: "",
          tvdbSeasonType: "aired",
          omdbKey: "",
        },
        update: () => {},
      }),
    },
    "@/lib/trakt/provider": { useTrakt: () => ({ isConnected: false }) },
    "@/lib/simkl/provider": { useSimkl: () => ({ isConnected: false }) },
    "@/lib/publicmetadb/provider": { usePublicMetaDb: () => ({ isConnected: true }) },
    "@/lib/i18n": { useT: () => (value) => value },
    "@/lib/manual-watched": {
      manualEpisodeKeys: () => ({ watched: new Set(), unwatched: new Set() }),
      manualWatchedVersion: () => 0,
      subscribeManualWatched: () => () => {},
    },
    "@/lib/episode-progress": { resumeDefaultSeason: () => 1 },
    "@/lib/episode-search": { episodeSearchVideos: () => [] },
    "@/lib/ai-models": { providerForModel: () => null },
    "@/lib/hidden-episodes": { useHiddenEpisodes: () => new Set() },
    "@/lib/settings/episode-order": {
      effectiveOrderProvider: () => "",
      tvdbPanelEnabled: () => false,
    },
    "@/lib/providers/tmdb": { tmdbSeasonEpisodes: async () => [] },
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": {
      pickLocalizedText: () => null,
      pickPreferredEpisodeTitle: () => null,
      pickPreferredEpisodeOverview: () => null,
    },
    "@/lib/meta-resource": {
      PREFERRED_TEXT_SCORE: 1,
      preferredVideoName: () => null,
      preferredVideoOverview: () => null,
    },
    "./series-episodes/use-watched-sets": {
      useWatchedSets: ({ pmdbConnected }) => {
        assert.equal(pmdbConnected, true);
        return { traktWatched: new Set(), simklWatched: new Set(), pmdbWatched };
      },
    },
    "./series-episodes/use-episode-enrich": {
      useEpisodeEnrich: () => ({ episodes: [], imdbRatings: new Map(), preferredVideos: new Map() }),
    },
    "./series-episodes/use-series-tvdb-stills": { useSeriesTvdbStills: () => ({}) },
    "./series-episodes/use-arc-groups": {
      useArcGroups: () => ({ hasArcs: false, arcs: [], episodes: [], loading: false }),
    },
    "./series-episodes/use-episode-order": { useEpisodeOrder: () => null },
    "./series-episodes/use-tvdb-season-types": { useTvdbSeasonTypes: () => [] },
    "./series-episodes/use-episode-progress-map": {
      useEpisodeProgressMap: (args) => {
        assert.equal(args.pmdbWatched, pmdbWatched);
        return { progressByEp: new Map(), spoilerFor: () => null, allWatched: false };
      },
    },
    "./series-episodes/use-mark-season": { useMarkSeason: () => () => {} },
    "./series-episodes/season-arc-picker": { SeasonArcPicker },
    "./helpers": { isNewSeason: () => false },
    "./episode-groups": {},
  };
  const { useSeasonArcPicker } = load("src/views/detail/series-episodes/use-season-arc-picker.ts", {
    react,
    "../helpers": { isNewSeason: () => false },
    "@/lib/season-view-pref": { getViewedSeason, setViewedSeason },
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({ from: "", to: "" }) },
  });
  mocks["./series-episodes/use-season-arc-picker"] = { useSeasonArcPicker };
  const { SeriesEpisodes } = load("src/views/detail/series-episodes.tsx", mocks);
  const seasons = [1, 2, 3].map((seasonNumber) => ({
    seasonNumber,
    episodeCount: 10,
    name: `Season ${seasonNumber}`,
  }));
  const render = () =>
    SeriesEpisodes({
      meta: { id: "series-1", name: "Fixture" },
      tvId: 1,
      imdbId: null,
      seasons,
      scrollRef: { current: null },
    });
  const findPicker = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === SeasonArcPicker) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = findPicker(child);
      if (result) return result;
    }
    return null;
  };

  setViewedSeason("series-1", 3);
  const firstPicker = findPicker(render());
  assert.equal(firstPicker.props.activeKey, "3");

  firstPicker.props.onSelect("2");
  assert.equal(getViewedSeason("series-1", seasons), 2);
  assert.equal(findPicker(render()).props.activeKey, "2");
});
