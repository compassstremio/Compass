import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { pickLocalizedText, pickPreferredEpisodeOverview, pickPreferredEpisodeTitle } from "../src/lib/localized-text.ts";
import { isForeignScriptTitle, isGenericEpisodeName, mergeTmdbEpisodes, mergeTvdbEpisodes } from "../src/lib/providers/anime-episode-build.ts";
import { episodeTextLanguage } from "../src/lib/episode-text-language.ts";
import * as placeholders from "../src/lib/providers/episode-placeholder.ts";
import { isStaleTvdbOrder } from "../src/lib/providers/tvdb-order-cache.ts";
import { isUpcomingDate } from "../src/lib/dates.ts";
import { resolveAnimeSlotMatch } from "../src/views/detail/anime-episodes/anime-slot-match.ts";

function load(path: string, mocks: Record<string, unknown>) {
  const dependencies: Record<string, unknown> = {
    "@/lib/providers/anime-episode-build": { isForeignScriptTitle, isGenericEpisodeName },
    "@/lib/dates": { isUpcomingDate },
    "./episode-placeholder": placeholders,
    "@/lib/providers/episode-placeholder": placeholders,
    "@/lib/providers/mal-episodes": { malEpisodeTitles: async () => null },
    ...mocks,
  };
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

function hooks(states: unknown[]) {
  let index = 0;
  return {
    useState: () => [states[index++], () => {}],
    useEffect: () => {},
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
  };
}

const text = { pickLocalizedText, pickPreferredEpisodeOverview, pickPreferredEpisodeTitle };
const finaleTitle = "You and I Are Polar Opposites";
const finaleOverview = "Suzuki watches Tani board the train.";

function episode(number = 13) {
  return {
    id: 400000 + number,
    number,
    seasonNumber: 1,
    imdbSeason: 2,
    imdbEpisode: number,
    streamId: `kitsu:50634:${number}`,
    title: "Christmas Eve",
    synopsis: "Copied synopsis",
    titleLanguage: "en",
    synopsisLanguage: "en",
    thumbnail: "existing.jpg",
    airdate: "2026-10-04",
    length: 24,
  };
}

function order(name = finaleTitle, nameEn = finaleTitle, overview = "", language = "en") {
  return {
    seasons: [{ seasonNumber: 1, name: "Season 1" }, { seasonNumber: 2, name: "Season 2" }],
    bySeason: new Map([
      [1, [{ id: 10, seasonNumber: 1, episodeNumber: 1, name: "Pilot", overview: "" }]],
      [2, [{ id: 213, seasonNumber: 2, episodeNumber: 13, name, nameEn, overview, nameLanguage: language, overviewLanguage: language, nameEnLanguage: "en" }]],
    ]),
    absByEpId: new Map(),
    imageByAbs: new Map(),
  };
}

test("TVDB episode titles outrank longer source titles, with source fallback for placeholders", () => {
  assert.equal(pickPreferredEpisodeTitle(["The Future"], [finaleTitle], "en"), "The Future");
  for (const missing of [undefined, "", "   ", "Episode 13"]) {
    assert.equal(pickPreferredEpisodeTitle([missing], ["Christmas Eve"], "en"), "Christmas Eve");
  }
});

test("metadata language ranks ahead of TVDB priority and English fallback", () => {
  for (const [lang, localized] of [["ko", "우리의 미래"], ["ar", "مستقبلنا"], ["ja", "私たちの未来"]]) {
    assert.equal(pickPreferredEpisodeTitle(["English title"], [localized], lang), localized);
    assert.equal(pickPreferredEpisodeTitle([localized, "A much longer English title"], [], lang), localized);
  }
  assert.equal(pickPreferredEpisodeTitle(["L’avenir", "A much longer English title"], [], "fr"), "L’avenir");
});

test("the TVDB merge corrects E13 title and synopsis without changing E1 or playback identity", () => {
  const episodes = [episode(1), episode(13)];
  const original = episodes.map((ep) => ({ ...ep }));
  mergeTvdbEpisodes(episodes, [
    { id: 201, seasonNumber: 2, number: 1, name: "Christmas Eve" },
    { id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview },
  ]);
  assert.deepEqual(episodes, [original[0], { ...original[1], title: finaleTitle, synopsis: finaleOverview }]);
});

test("English fallback cannot overwrite chosen localized TVDB text", () => {
  const ep = episode();
  mergeTvdbEpisodes([ep], [{ id: 213, seasonNumber: 2, number: 13, name: "우리의 미래", overview: "스즈키는 타니가 기차에 타는 모습을 지켜본다." }], { lang: "ko" });
  mergeTvdbEpisodes([ep], [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview }], { fallbackOnly: true });
  assert.equal(ep.title, "우리의 미래");
  assert.equal(ep.synopsis, "스즈키는 타니가 기차에 타는 모습을 지켜본다.");

  const untranslated = { ...episode(), title: "Episode 13" };
  mergeTvdbEpisodes([untranslated], [{ id: 213, seasonNumber: 2, number: 13, name: "日本語" }], { lang: "ko" });
  mergeTvdbEpisodes([untranslated], [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle }], { fallbackOnly: true });
  assert.equal(untranslated.title, finaleTitle);
});

test("ordinary anime ordering uses TVDB text on matched streaming episodes", () => {
  const { buildAnimeOrder } = load("src/views/detail/anime-episodes/anime-order-utils.ts", {
    "@/lib/localized-text": text,
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  const ep = episode();
  const built = buildAnimeOrder(order(finaleTitle, finaleTitle, finaleOverview), [ep], "Specials", "en");
  assert.deepEqual(built.subsetByKey.get("2"), [{ ...ep, title: finaleTitle, synopsis: finaleOverview }]);
  assert.equal(ep.title, "Christmas Eve", "rendering must not mutate the cached source");
  assert.equal(ep.synopsis, "Copied synopsis");
});

test("the anime TVDB panel uses the selected language on matched franchise episodes", () => {
  for (const [lang, name, synopsis] of [
    ["en", finaleTitle, finaleOverview],
    ["ko", "우리의 미래", "스즈키는 타니가 기차에 타는 모습을 지켜본다."],
    ["fr", "L’avenir", "Suzuki regarde Tani monter dans le train."],
  ]) {
    const ep = { ...episode(), sourceMetaId: "kitsu:50634" };
    const { useAnimeTvdbPanel } = load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
      react: hooks([1, order(name, finaleTitle, synopsis, lang), [], "aired", "2", true, "has", null]),
      "@/lib/i18n": { useT: () => (s: string) => s },
      "@/lib/providers/anime-mapping": {},
      "@/lib/providers/anime-detail": {},
      "@/lib/providers/tvdb": {},
      "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => lang },
      "@/lib/localized-text": text,
      "@/lib/providers/compass-imdb": {},
      "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
      "@/lib/streams/anime-identity": {},
      "./anime-slot-match": { resolveAnimeSlotMatch },
    });
    const { panel } = useAnimeTvdbPanel(49372, null, [], "aired", "", true, [ep]);
    assert.deepEqual(panel.visibleEpisodes, [{ ...ep, title: name, synopsis, titleLanguage: lang, synopsisLanguage: lang }]);
    assert.equal(panel.items.find((item: any) => item.key === "2").name, "Season 2");
  }
});

test("TVDB descriptions outrank longer copied text, while retaining language and missing-data fallbacks", () => {
  const copied = "As their first Christmas Eve together approaches, Suzuki and Tani plan their date. ".repeat(4);
  assert.equal(pickPreferredEpisodeOverview([finaleOverview], [copied], "en"), finaleOverview);
  for (const missing of [undefined, "", "   "]) {
    assert.equal(pickPreferredEpisodeOverview([missing], [copied], "en"), copied.trim());
  }
  const korean = "스즈키는 타니가 기차에 타는 모습을 지켜본다.";
  assert.equal(pickPreferredEpisodeOverview([finaleOverview], [korean], "ko"), korean);
  assert.equal(pickPreferredEpisodeOverview([korean, finaleOverview], [copied], "ko"), korean);
  assert.equal(pickPreferredEpisodeOverview(["Suzuki regarde Tani.", copied], [], "fr"), "Suzuki regarde Tani.");
});

test("the TVDB merge keeps existing descriptions when the match or overview is absent", () => {
  for (const provider of [
    { id: 113, seasonNumber: 1, number: 13, overview: "Wrong season" },
    { id: 213, seasonNumber: 2, number: 13, overview: "   " },
  ]) {
    const ep = episode();
    mergeTvdbEpisodes([ep], [provider]);
    assert.equal(ep.synopsis, "Copied synopsis");
  }
  const ep = { ...episode(), synopsis: "" };
  mergeTvdbEpisodes([ep], [{ id: 213, seasonNumber: 2, number: 13, overview: finaleOverview }], { fallbackOnly: true });
  assert.equal(ep.synopsis, finaleOverview);
});

test("built-in series descriptions prefer existing TVDB data in the selected metadata language", () => {
  for (const [lang, source, provider, expected] of [
    ["en", "Copied Christmas synopsis ".repeat(20), finaleOverview, finaleOverview],
    ["ko", "한국어 줄거리", finaleOverview, "한국어 줄거리"],
    ["fr", "Un très long résumé incorrect", "Suzuki regarde Tani.", "Suzuki regarde Tani."],
    ["en", "Existing synopsis", "   ", "Existing synopsis"],
  ]) {
    const { useEpisodeEnrich } = load("src/views/detail/series-episodes/use-episode-enrich.ts", {
      react: hooks([new Map([[`:${lang}:2`, new Map([[13, { overview: provider, overviewLanguage: lang === "ko" ? "en" : lang }]])]]), new Map()]),
      "@/lib/localized-text": text,
      "@/lib/meta-resource": {
        PREFERRED_TEXT_SCORE: 1000,
        preferredVideoName: () => "",
        preferredVideoOverview: () => "",
      },
      "../use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map() },
      "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => lang },
      "@/lib/providers/tvdb": {},
    });
    const ep = { seasonNumber: 2, episodeNumber: 13, name: finaleTitle, nameLanguage: "en", overview: source, overviewLanguage: lang, runtime: 24, airDate: null };
    const { episodes } = useEpisodeEnrich({ episodes: [ep], active: 2, preferCustomMeta: false });
    assert.deepEqual(episodes, [{ ...ep, overview: expected }]);
  }
});

test("built-in series enrichment prefers TVDB titles while retaining language preferences", () => {
  for (const [lang, source, tvdb, expected] of [
    ["en", "A much longer but incorrect episode title", "The Future", "The Future"],
    ["ko", "우리의 미래", "English title", "우리의 미래"],
    ["fr", "Un très long titre incorrect", "L’avenir", "L’avenir"],
    ["en", "Christmas Eve", "Episode 13", "Christmas Eve"],
  ]) {
    const { useEpisodeEnrich } = load("src/views/detail/series-episodes/use-episode-enrich.ts", {
      react: hooks([new Map([[`:${lang}:2`, new Map([[13, { name: tvdb, nameLanguage: lang === "ko" ? "en" : lang }]])]]), new Map()]),
      "@/lib/localized-text": text,
      "@/lib/meta-resource": {
        PREFERRED_TEXT_SCORE: 1000,
        preferredVideoName: () => "",
        preferredVideoOverview: () => "",
      },
      "../use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map() },
      "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => lang },
      "@/lib/providers/tvdb": {},
    });
    const ep = { seasonNumber: 2, episodeNumber: 13, name: source, nameLanguage: lang, overview: "", overviewLanguage: undefined, runtime: 24, airDate: null };
    const { episodes } = useEpisodeEnrich({ episodes: [ep], active: 2, preferCustomMeta: false });
    assert.deepEqual(episodes, [{ ...ep, name: expected }]);
  }
});

const turkishTitle = "Sonun başlangıcı ve başlangıcın sonu";
const turkishOverview = "Subaru başka bir dünyaya çağrılır.";

test("translation evidence distinguishes Turkish from English and treats fields independently", () => {
  assert.equal(episodeTextLanguage(finaleTitle, "tur", finaleTitle), "en");
  assert.equal(episodeTextLanguage(turkishTitle, "tr-TR", finaleTitle), "und");
  assert.equal(episodeTextLanguage(finaleOverview, "tr", finaleOverview), "en");
  assert.equal(episodeTextLanguage(turkishOverview, "tr", finaleOverview), "und");
  assert.equal(episodeTextLanguage("Unverified Latin text", "tr"), "und");
  assert.equal(episodeTextLanguage(turkishTitle, "tur", undefined, ["tur"]), "tr");
  assert.equal(pickPreferredEpisodeTitle([{ text: "Rem", language: "en" }], [], "tr"), "Rem");
});

test("Turkish TMDB text beats TVDB English fallback for titles and descriptions", () => {
  assert.equal(pickPreferredEpisodeTitle(
    [{ text: finaleTitle, language: "en" }], [{ text: turkishTitle, language: "tr" }], "tr",
  ), turkishTitle);
  assert.equal(pickPreferredEpisodeOverview(
    [{ text: finaleOverview, language: "en" }], [{ text: turkishOverview, language: "tr" }], "tr",
  ), turkishOverview);
  assert.equal(pickPreferredEpisodeTitle(
    [{ text: "Unverified TVDB text", language: "und" }], [{ text: turkishTitle, language: "und" }], "tr",
  ), turkishTitle, "uncertain provider text must not override the existing requested-language response");
});

test("TVDB wins when both providers have the requested language, and remains the English fallback", () => {
  for (const lang of ["tr", "fr", "de", "en"]) {
    assert.equal(pickPreferredEpisodeTitle(
      [{ text: "TVDB translation", language: lang }], [{ text: "TMDB translation", language: lang }], lang,
    ), "TVDB translation");
  }
  assert.equal(pickPreferredEpisodeOverview(
    [{ text: finaleOverview, language: "en" }], [{ text: "Other English text", language: "en" }], "tr",
  ), finaleOverview);
});

test("the anime merge retains Turkish TMDB metadata through English fallback and TVDB ordering", () => {
  const ep = episode();
  const tvdbEnglish = [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview }];
  const tmdbEnglish = [{ id: 213, seasonNumber: 2, episodeNumber: 13, name: finaleTitle, overview: finaleOverview }];
  const tmdbTurkish = [{ ...tmdbEnglish[0], name: turkishTitle, overview: turkishOverview }];
  mergeTvdbEpisodes([ep], tvdbEnglish, { lang: "tr", englishEpisodes: tvdbEnglish });
  mergeTmdbEpisodes([ep], tmdbTurkish as any, { lang: "tr", englishEpisodes: tmdbEnglish as any });
  mergeTvdbEpisodes([ep], tvdbEnglish, { fallbackOnly: true });
  mergeTmdbEpisodes([ep], tmdbEnglish as any);
  assert.equal(ep.title, turkishTitle);
  assert.equal(ep.synopsis, turkishOverview);
  assert.equal(ep.titleLanguage, "und");
  assert.equal(ep.synopsisLanguage, "und");

  const { buildAnimeOrder } = load("src/views/detail/anime-episodes/anime-order-utils.ts", {
    "@/lib/localized-text": text,
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  const selected = buildAnimeOrder(order(finaleTitle, finaleTitle, finaleOverview), [ep], "Specials", "tr").subsetByKey.get("2")[0];
  assert.deepEqual(selected, ep);
});

test("mixed translation availability selects the title and description independently", () => {
  const ep = episode();
  const englishTvdb = [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview }];
  const englishTmdb = [{ id: 213, seasonNumber: 2, episodeNumber: 13, name: finaleTitle, overview: finaleOverview }];
  mergeTvdbEpisodes([ep], [{ ...englishTvdb[0], name: turkishTitle, nameLanguage: "tr" }], { lang: "tr", englishEpisodes: englishTvdb });
  mergeTmdbEpisodes([ep], [{ ...englishTmdb[0], overview: turkishOverview, overviewLanguage: "tr" }] as any, { lang: "tr", englishEpisodes: englishTmdb as any });
  assert.equal(ep.title, turkishTitle);
  assert.equal(ep.synopsis, turkishOverview);
  assert.equal(ep.titleLanguage, "tr");
  assert.equal(ep.synopsisLanguage, "tr");
});

test("TVDB ordering preserves translation evidence with the same existing requests", async () => {
  const requests: string[] = [];
  const english = [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview }];
  const { fetchTvdbOrderBySeriesId } = load("src/lib/providers/tvdb-order.ts", {
    "./tvdb": {
      tvdbSeasonNames: async () => new Map([[2, "Season 2"]]),
      tvdbEpisodesByType: async (_key: string, _id: number, type: string, lang?: string) => {
        requests.push(`${type}:${lang ?? "default"}`);
        return lang === "tur" ? [{ ...english[0], overview: turkishOverview, overviewLanguage: "tr" }] : english;
      },
    },
    "./tvdb-order-cache": { isStaleTvdbOrder, readOrderCache: () => null, writeOrderCache: () => {} },
    "@/lib/episode-text-language": { episodeTextLanguage },
  });
  const ordering = await fetchTvdbOrderBySeriesId("", 42, "aired", "tur");
  const selected = ordering.bySeason.get(2)[0];
  assert.equal(selected.nameLanguage, "en");
  assert.equal(selected.overviewLanguage, "tr");
  assert.deepEqual(requests, ["default:default", "default:tur", "default:eng"]);
  await fetchTvdbOrderBySeriesId("", 42, "aired", "tur");
  assert.equal(requests.length, 3, "cached ordering must not repeat requests");
});

test("persisted ordering carries provenance, ignores old entries, and separates languages", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  } });
  try {
    const cache = load("src/lib/providers/tvdb-order-cache.ts", {});
    entries.set("compass.tvdbo.v5.42:aired:tur", JSON.stringify({ t: Date.now() }));
    assert.equal(cache.readOrderCache(42, "aired:tur"), null);
    cache.writeOrderCache(42, "aired:tur", order(turkishTitle, finaleTitle, turkishOverview, "tr"));
    assert.equal(cache.readOrderCache(42, "aired:tur").bySeason.get(2)[0].nameLanguage, "tr");
    assert.equal(cache.readOrderCache(42, "aired:eng"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});

test("the anime TVDB panel keeps Turkish source metadata when TVDB only has English", () => {
  const ep = { ...episode(), title: turkishTitle, synopsis: turkishOverview, titleLanguage: "tr", synopsisLanguage: "tr" };
  const { useAnimeTvdbPanel } = load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
    react: hooks([1, order(finaleTitle, finaleTitle, finaleOverview), [], "aired", "2", true, "has", null]),
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/anime-detail": {},
    "@/lib/providers/tvdb": {},
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "tr" },
    "@/lib/localized-text": text,
    "@/lib/providers/compass-imdb": {},
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
    "@/lib/streams/anime-identity": {},
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  const { panel } = useAnimeTvdbPanel(49372, null, [ep], "aired", "", true);
  assert.deepEqual(panel.visibleEpisodes, [ep]);
});

test("built-in series selects the language-scoped cached data without reusing English for Turkish", () => {
  const bySeason = new Map([
    [":en:2", new Map([[13, { name: finaleTitle, overview: finaleOverview, nameLanguage: "en", overviewLanguage: "en" }]])],
    [":tr:2", new Map([[13, { name: finaleTitle, overview: finaleOverview, nameLanguage: "en", overviewLanguage: "en" }]])],
  ]);
  for (const lang of ["tr", "en"]) {
    const { useEpisodeEnrich } = load("src/views/detail/series-episodes/use-episode-enrich.ts", {
      react: hooks([bySeason, new Map()]),
      "@/lib/localized-text": text,
      "@/lib/meta-resource": { PREFERRED_TEXT_SCORE: 1000, preferredVideoName: () => "", preferredVideoOverview: () => "" },
      "../use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map() },
      "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => lang },
      "@/lib/providers/tvdb": {},
    });
    const ep = {
      seasonNumber: 2, episodeNumber: 13, name: turkishTitle, overview: turkishOverview,
      nameLanguage: "tr", overviewLanguage: "tr", runtime: 24, airDate: null,
    };
    const selected = useEpisodeEnrich({ episodes: [ep], active: 2, preferCustomMeta: false }).episodes[0];
    assert.equal(selected.name, lang === "tr" ? turkishTitle : finaleTitle);
    assert.equal(selected.overview, lang === "tr" ? turkishOverview : finaleOverview);
    assert.equal(selected.nameLanguage, lang);
    assert.equal(selected.overviewLanguage, lang);
  }
});

test("franchise loading reuses the existing localized and English requests and retains Turkish text", async () => {
  const tmdbRequests: string[] = [];
  const tvdbRequests: string[] = [];
  const englishTmdb = { id: 213, seasonNumber: 2, episodeNumber: 13, name: finaleTitle, overview: finaleOverview };
  const englishTvdb = { id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview };
  const { fetchEntryEpisodes } = load("src/lib/providers/anime-franchise-episodes.ts", {
    "@/lib/providers/anizip": { aniZipByKitsu: async () => ({ mappings: { themoviedb_id: 123 }, episodes: { 13: { seasonNumber: 2, episodeNumber: 13 } } }) },
    "@/lib/providers/anime-episode-build": { buildKitsuEpisodes: (_addon: unknown, raw: unknown) => raw, mergeAniZipEpisodes: () => {}, mergeTmdbEpisodes, mergeTvdbEpisodes },
    "@/lib/providers/anime-episode-enrich": { enrichEpisodes: async () => {} },
    "@/lib/providers/anime-kitsu-addon": { animeKitsuMeta: async () => null },
    "@/lib/providers/kitsu": { kitsuEpisodes: async () => [episode()] },
    "@/lib/providers/anime-mapping": { kitsuToTvdb: async () => 42, applyAnidbSeasonWindow: async () => {} },
    "@/lib/providers/tvdb": {
      tvdbLangFromIso1: (lang: string) => lang === "tr" ? "tur" : "eng",
      tvdbEpisodesByType: async (_key: string, _id: number, _type: string, lang: string) => { tvdbRequests.push(`default:${lang}`); return [englishTvdb]; },
      tvdbEpisodesAbsolute: async (_key: string, _id: number, lang: string) => { tvdbRequests.push(`absolute:${lang}`); return []; },
    },
    "@/lib/providers/tmdb/tmdb-details": {
      tmdbSeasonEpisodes: async (_key: string, _id: number, season: number, lang: string) => {
        tmdbRequests.push(`${season}:${lang}`);
        return season === 2 ? [lang === "tr" ? { ...englishTmdb, name: turkishTitle, overview: turkishOverview } : englishTmdb] : [];
      },
    },
  });
  const settings = { tmdbLanguage: "tr", tmdbKey: "fixture", tvdbKey: "" };
  const episodes = await fetchEntryEpisodes(50634, settings);
  assert.equal(episodes[0].title, turkishTitle);
  assert.equal(episodes[0].synopsis, turkishOverview);
  assert.equal(episodes[0].titleLanguage, "und");
  assert.equal(episodes[0].sourceMetaId, "kitsu:50634");
  assert.deepEqual(tmdbRequests, ["1:tr", "2:tr", "1:en", "2:en"]);
  assert.deepEqual(tvdbRequests, ["default:tur", "absolute:tur", "default:eng", "absolute:eng"]);
  await fetchEntryEpisodes(50634, settings);
  assert.equal(tmdbRequests.length, 4);
  assert.equal(tvdbRequests.length, 4);
});

test("real source text beats translated placeholders in merges and selectors", () => {
  for (const placeholder of ["TBA", "TBD", "Unknown", "To be announced"]) {
    const ep = episode();
    const original = { ...ep };
    mergeTvdbEpisodes([ep], [{ id: 213, seasonNumber: 2, number: 13, name: placeholder, overview: placeholder, nameLanguage: "tr", overviewLanguage: "tr" }], { lang: "tr" });
    assert.deepEqual(ep, original);
    for (const select of [pickPreferredEpisodeTitle, pickPreferredEpisodeOverview]) {
      assert.equal(select([{ text: placeholder, language: "tr" }], [{ text: finaleTitle, language: "en" }], "tr"), finaleTitle);
      assert.equal(select([{ text: placeholder, language: "en" }], [], "en"), placeholder);
    }
  }
  const empty = { ...episode(), title: "Episode 13", synopsis: "" };
  mergeTvdbEpisodes([empty], [{ id: 213, seasonNumber: 2, number: 13, name: "TBA", overview: "TBA" }]);
  assert.equal(empty.title, "TBA");
  assert.equal(empty.synopsis, "TBA");
});

test("original Latin text cannot be confirmed as Turkish merely by differing from English", () => {
  const frenchTitle = "Le début de la fin";
  assert.equal(episodeTextLanguage(frenchTitle, "tr", finaleTitle, ["eng", "fra"]), "und");
  assert.equal(episodeTextLanguage(frenchTitle, "tr", finaleTitle, []), "und");
  assert.equal(episodeTextLanguage(frenchTitle, "tr", finaleTitle), "und");
  assert.equal(episodeTextLanguage(turkishTitle, "tr-TR", finaleTitle, ["eng", "tur"]), "tr");
  for (const confirmed of [false, true]) {
    const ep = episode();
    mergeTvdbEpisodes([ep], [{ id: 213, seasonNumber: 2, number: 13, name: frenchTitle, overview: "Une description française", nameLanguage: "und", overviewLanguage: "und" }], {
      lang: "tr", englishEpisodes: [{ id: 213, seasonNumber: 2, number: 13, name: finaleTitle, overview: finaleOverview }],
    });
    mergeTmdbEpisodes([ep], [{ id: 213, seasonNumber: 2, episodeNumber: 13, name: turkishTitle, overview: turkishOverview, nameLanguage: confirmed ? "tr" : "und", overviewLanguage: confirmed ? "tr" : "und" }] as any, { lang: "tr" });
    assert.equal(ep.title, turkishTitle);
    assert.equal(ep.synopsis, turkishOverview);
    assert.equal(ep.titleLanguage, confirmed ? "tr" : "und");
  }
});

test("TVDB response parsing honors missing translations separately for names and overviews", async () => {
  let requests = 0;
  const provider = load("src/lib/providers/tvdb.ts", {
    "@/lib/cache": { lruSet: (cache: Map<string, unknown>, key: string, value: unknown) => cache.set(key, value) },
    "@/lib/memory-profiler": { registerCache: () => {} },
    "@/lib/config/endpoints": { COMPASS_TVDB_BASE: "https://fixture.invalid" },
    "@/lib/episode-text-language": { episodeTextLanguage },
    "@/lib/safe-fetch": { safeFetch: async () => {
      requests++;
      return { ok: true, status: 200, json: async () => ({ data: { episodes: [{
        id: 213, seasonNumber: 2, number: 13,
        name: "Le début de la fin", overview: turkishOverview,
        nameTranslations: ["eng", "fra"], overviewTranslations: ["eng", "tur"],
      }] } }) };
    } },
  });
  for (const rows of [await provider.tvdbEpisodes("", 42, 2, "tur"), await provider.tvdbEpisodesByType("", 42, "default", "tur")]) {
    assert.equal(rows[0].nameLanguage, "und");
    assert.equal(rows[0].overviewLanguage, "tr");
  }
  const original = await provider.tvdbEpisodesByType("", 42, "default");
  assert.equal(original[0].nameLanguage, "und");
  assert.equal(original[0].overviewLanguage, "und");
  assert.equal(requests, 3);
  await provider.tvdbEpisodesByType("", 42, "default", "tur");
  assert.equal(requests, 3, "cached responses are reused");
});

test("ordering preserves original fallback provenance without extra requests", async () => {
  const requests: string[] = [];
  const original = { id: 213, seasonNumber: 2, number: 13, name: "鬼の血", overview: "物語の説明", nameLanguage: "und", overviewLanguage: "und" };
  const { fetchTvdbOrderBySeriesId } = load("src/lib/providers/tvdb-order.ts", {
    "./tvdb": {
      tvdbSeasonNames: async () => new Map(),
      tvdbEpisodesByType: async (_key: string, _id: number, type: string, lang?: string) => {
        requests.push(`${type}:${lang ?? "default"}`);
        return lang === "eng" ? [] : [original];
      },
    },
    "./tvdb-order-cache": { isStaleTvdbOrder, readOrderCache: () => null, writeOrderCache: () => {} },
    "@/lib/episode-text-language": { episodeTextLanguage },
  });
  const ordering = await fetchTvdbOrderBySeriesId("", 42, "aired", "eng");
  const selected = ordering.bySeason.get(2)[0];
  assert.equal(selected.nameEn, original.name);
  assert.equal(selected.overviewEn, original.overview);
  assert.equal(selected.nameEnLanguage, "und");
  assert.equal(selected.overviewEnLanguage, "und");
  assert.deepEqual(requests, ["default:default", "default:eng"]);
  await fetchTvdbOrderBySeriesId("", 42, "aired", "eng");
  assert.equal(requests.length, 2);
});

test("English titles and descriptions survive original-language fallbacks in anime ordering and the panel", () => {
  const ep = episode();
  const originalOrder = order("鬼の血", "鬼の血", "物語の説明", "und");
  Object.assign(originalOrder.bySeason.get(2)![0], { overviewEn: "物語の説明", nameEnLanguage: "und", overviewEnLanguage: "und" });
  const { buildAnimeOrder } = load("src/views/detail/anime-episodes/anime-order-utils.ts", {
    "@/lib/localized-text": text,
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  assert.deepEqual(buildAnimeOrder(originalOrder, [ep], "Specials", "en").subsetByKey.get("2"), [ep]);
  const { useAnimeTvdbPanel } = load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
    react: hooks([1, originalOrder, [], "aired", "2", true, "has", null]),
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/anime-detail": {},
    "@/lib/providers/tvdb": {},
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": text,
    "@/lib/providers/compass-imdb": {},
    "@/lib/providers/tvdb-order": { seasonDateRange: () => ({}) },
    "@/lib/streams/anime-identity": {},
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  assert.deepEqual(useAnimeTvdbPanel(49372, null, [ep], "aired", "", true).panel.visibleEpisodes, [ep]);
  assert.equal(episodeTextLanguage("鬼の血", "en", "鬼の血"), "und");
  assert.equal(pickPreferredEpisodeOverview([{ text: "物語の説明", language: "en" }], [{ text: finaleOverview, language: "en" }], "en"), finaleOverview);
});

test("legacy order caches retain their data but downgrade unreliable language evidence", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  } });
  try {
    const cache = load("src/lib/providers/tvdb-order-cache.ts", {});
    cache.writeOrderCache(42, "aired:tur", order("Le début", "物語", "Une description", "tr"));
    const key = "compass.tvdbo.v8.42:aired:tur";
    const legacy = JSON.parse(entries.get(key)!);
    delete legacy.textEvidenceVersion;
    entries.set(key, JSON.stringify(legacy));
    const restored = cache.readOrderCache(42, "aired:tur");
    assert.ok(restored, "normalizing old evidence must not force another fetch");
    const ep = restored.bySeason.get(2)[0];
    assert.equal(ep.name, "Le début");
    assert.equal(ep.nameLanguage, "und");
    assert.equal(ep.nameEnLanguage, "und");
    assert.equal(ep.overviewLanguage, "und");
    assert.equal(ep.overviewEnLanguage, "und");
    assert.equal(pickPreferredEpisodeTitle([{ text: ep.name, language: ep.nameLanguage }], [{ text: turkishTitle, language: "tr" }], "tr"), turkishTitle);
    assert.equal(cache.readOrderCache(42, "aired:eng"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});

test("built-in series enrichment retains real text when TVDB supplies placeholders or Japanese", () => {
  for (const provider of ["TBA", "物語の説明"]) {
    const { useEpisodeEnrich } = load("src/views/detail/series-episodes/use-episode-enrich.ts", {
      react: hooks([new Map([[":en:2", new Map([[13, { name: provider, overview: provider, nameLanguage: "und", overviewLanguage: "und" }]])]]), new Map()]),
      "@/lib/localized-text": text,
      "@/lib/meta-resource": { PREFERRED_TEXT_SCORE: 1000, preferredVideoName: () => "", preferredVideoOverview: () => "" },
      "../use-episode-imdb-ratings": { useEpisodeImdbRatings: () => new Map() },
      "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
      "@/lib/providers/tvdb": {},
    });
    const ep = { seasonNumber: 2, episodeNumber: 13, name: finaleTitle, overview: finaleOverview, nameLanguage: "en", overviewLanguage: "en", runtime: 24, airDate: null };
    assert.deepEqual(useEpisodeEnrich({ episodes: [ep], active: 2, preferCustomMeta: false }).episodes, [ep]);
  }
});
