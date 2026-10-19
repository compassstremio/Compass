// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const home = read("src/views/home.tsx");
const homeRows = read("src/views/home/home-rows.ts");
const watchedTitle = read("src/lib/watched-title.ts");
const customRows = read("src/views/home/customizable-rows.tsx");

test("the featured hero skips watched titles behind the setting", () => {
  assert.match(watchedTitle, /export function isTitleWatched/);
  assert.match(home, /const heroWatched = useMemo/);
  assert.match(home, /settings\.hideWatchedInHero/);
  assert.match(home, /simklWatchedForId\(simklWatchedMap/);
});

test("the hero counts titles marked watched before they entered the hero", () => {
  // markMetaWatched writes these two stores, so the hero must read them too.
  assert.match(watchedTitle, /watchedFlags\?\.has\(id\)/);
  assert.match(watchedTitle, /movieWatched\?\.has\(id\)/);
  assert.match(home, /useWatchedFlagIds\(\)/);
  assert.match(home, /useMovieWatchedIds\(\)/);
});

test("watched hero slots backfill from their source row", () => {
  assert.match(homeRows, /heroRows/, "builders must report which row each hero slot came from");
  assert.match(
    home,
    /rows\.find\(\(r\) => r\.key === key\)/,
    "the hero must pull the next unwatched candidate from the same row",
  );
  assert.match(home, /heroRows\.length > 0/);
});

test("Simkl movies count as watched through their completed status", () => {
  assert.match(home, /m\.type === "movie" && statusForId\(simklStatusMap, m\.id\) === "completed"/);
});

test("watched matching bridges imdb and tmdb ids", () => {
  assert.match(watchedTitle, /function watchedIdCandidates/);
  assert.match(watchedTitle, /tmdbImdbCached\(id\)/);
  assert.match(watchedTitle, /tmdbFromImdbCached\(id\)/);
});

test("catalog rows and the hero share one watched predicate", () => {
  assert.match(customRows, /from "@\/lib\/watched-title"/);
  assert.doesNotMatch(
    customRows,
    /function metaTitleKey/,
    "the row predicate must use the shared helper, not a private copy",
  );
});

// Runs the real watched-title predicates with the tmdb bridge mocked out.
function loadWatchedTitle(): Record<string, any> {
  const source = read("src/lib/watched-title.ts");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", code)(
    (id: string) => {
      if (id === "@/lib/playback-history") {
        return { watchTitleKey: (name?: string) => name?.trim().toLowerCase() ?? null };
      }
      if (id === "@/lib/providers/tmdb/tmdb-imdb-resolve") {
        return { tmdbFromImdbCached: () => null, tmdbImdbCached: () => null };
      }
      throw new Error(`Unexpected dependency: ${id}`);
    },
    exports,
  );
  return exports;
}

test("a watched tmdb movie cannot hide a show with the same tmdb id", () => {
  const { isTitleWatched, collapseWatchedKeys } = loadWatchedTitle();
  const traktKeys = collapseWatchedKeys(new Set(["tmdb:603"]));
  assert.equal(
    isTitleWatched({ id: "tmdb:movie:603", name: "The Matrix" }, { traktKeys }),
    true,
    "the watched movie itself stays hidden",
  );
  assert.equal(
    isTitleWatched({ id: "tmdb:tv:603", name: "Unrelated Show" }, { traktKeys }),
    false,
    "an unrelated show sharing the tmdb id must not be hidden",
  );
});

test("a watched tmdb episode cannot hide a movie with the same tmdb id", () => {
  const { isTitleWatched, collapseWatchedKeys } = loadWatchedTitle();
  const traktKeys = collapseWatchedKeys(new Set(["tmdb:100:1:2"]));
  assert.equal(isTitleWatched({ id: "tmdb:tv:100", name: "Show" }, { traktKeys }), true);
  assert.equal(
    isTitleWatched({ id: "tmdb:movie:100", name: "Unrelated Movie" }, { traktKeys }),
    false,
  );
});

test("imdb episode folds still mark their show as watched", () => {
  const { isTitleWatched, collapseWatchedKeys } = loadWatchedTitle();
  const traktKeys = collapseWatchedKeys(new Set(["imdb:tt0944947:1:1"]));
  assert.equal(
    isTitleWatched({ id: "tt0944947", name: "Game of Thrones" }, { traktKeys }),
    true,
  );
});
