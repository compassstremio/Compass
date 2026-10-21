import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { Meta } from "../src/lib/cinemeta.ts";
import type { AniZipMapping } from "../src/lib/providers/anizip.ts";
import type { KitsuAnimeDetail } from "../src/lib/providers/kitsu.ts";

type Anime = Pick<KitsuAnimeDetail, "id" | "title" | "altTitles" | "subtype" | "year" | "episodeCount">;
const special: Anime = {
  id: 12625, title: "Black Clover: Jump Festa 2016 Special", altTitles: ["Black Clover"],
  subtype: "special", year: "2016", episodeCount: 1,
};
const tv: Anime = {
  id: 13209, title: "Black Clover", altTitles: ["Black Clover (2017)"],
  subtype: "TV", year: "2017", episodeCount: 170,
};
const tvMapping: AniZipMapping = {
  mappings: { kitsu_id: 13209, imdb_id: "tt7441658", themoviedb_id: "73223" },
};
const meta = (id = "tmdb:tv:73223", patch: Partial<Meta> = {}): Meta => ({
  id, name: "Black Clover", type: "series", releaseInfo: "2017", ...patch,
});

function fixture() {
  const anime = new Map<number, Anime>([[12625, { ...special }], [13209, { ...tv }]]);
  const mappings = new Map<number, AniZipMapping>([[13209, structuredClone(tvMapping)]]);
  const related = [{ role: "other", meta: meta("kitsu:13209") }];
  const calls = { related: 0, mappings: [] as number[], external: 0, verdicts: 0 };
  let failure = "";
  const mocks: Record<string, unknown> = {
    "@/lib/providers/kitsu": {
      kitsuAnime: async (id: number) => {
        if (failure === "candidate" && id !== 12625) throw new Error("offline");
        return anime.get(id) ?? null;
      },
      kitsuRelated: async () => {
        calls.related += 1;
        if (failure === "related") throw new Error("offline");
        return related;
      },
      parseKitsuId: (id: string) => /^kitsu:(\d+)$/.test(id) ? Number(id.slice(6)) : null,
    },
    "@/lib/providers/anizip": {
      aniZipByKitsu: async (id: number) => {
        calls.mappings.push(id);
        if (failure === "mapping") throw new Error("offline");
        return mappings.get(id) ?? null;
      },
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/views/detail/resolve-anime-entry.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const api = {} as typeof import("../src/views/detail/resolve-anime-entry.ts");
  new Function("require", "exports", code)((id: string) => {
    assert.ok(id in mocks, id);
    return mocks[id];
  }, api);
  return { ...api, anime, mappings, related, calls, fail: (value: string) => { failure = value; } };
}

// Exercise the real detection effect as well as the guard so a missing or
// misplaced call cannot leave the permissive year check accepting the special.
const detailSource = readFileSync(new URL("../src/views/detail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("detail.tsx", detailSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let detectionEffect = "";
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("await tmdbTvToKitsu(tmdbTv)")) {
    detectionEffect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

async function detect(h: ReturnType<typeof fixture>, request: Meta, recorded: string | null = null) {
  assert.ok(detectionEffect, "real detail detection effect was found");
  const detected: number[] = [];
  let finish!: () => void;
  const settled = new Promise<void>((resolve) => { finish = resolve; });
  const context = {
    idAnime: false, detectedKitsu: null, addonNative: false, meta: request, detail: null,
    failedKitsu: { current: null },
    getAnimeCanonicalId: () => recorded,
    parseKitsuId: (id: string) => Number(id.slice(6)),
    tmdbTvToKitsu: async () => { h.calls.external += 1; return 12625; },
    imdbToKitsu: async () => { h.calls.external += 1; return 12625; },
    resolveDetailAnimeEntry: h.resolveDetailAnimeEntry,
    kitsuYearVerdict: async () => { h.calls.verdicts += 1; return "ok"; },
    setDetectedKitsu: (id: number) => { detected.push(id); },
    setDetectingAnime: (active: boolean) => { if (!active) finish(); },
    searchAnime: () => assert.fail("a conflicting mapping must not enter orphan title search"),
  };
  const compiled = ts.transpileModule(
    "return (" + detectionEffect + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const cleanup = new Function(...Object.keys(context), compiled)(...Object.values(context))();
  await settled;
  cleanup();
  return detected;
}

for (const id of ["tmdb:tv:73223", "tt7441658"]) {
  test("the real detail path corrects Black Clover from " + id, async () => {
    const h = fixture();
    assert.deepEqual(await detect(h, meta(id)), [13209]);
    assert.deepEqual(h.calls.mappings, [13209]);
  });
}

test("a TMDB entry verifies the known IMDb ID as well", async () => {
  const h = fixture();
  h.mappings.get(13209)!.mappings!.imdb_id = "tt999";
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(), {
    title: "Black Clover", year: "2017", imdbId: "tt7441658",
  }), null);
});

test("normal TV entries, multi-episode side entries, and the requested special stay unchanged", async () => {
  const h = fixture();
  assert.equal(await h.resolveDetailAnimeEntry(13209, meta(), null), 13209);
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta("tt7441658", { releaseInfo: "2016" }), null), 12625);
  h.anime.get(12625)!.episodeCount = 8;
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(), null), 12625);
  assert.equal(h.calls.related, 0);
});

test("direct anime IDs, movies, and explicit special formats bypass the guard", async () => {
  const h = fixture();
  for (const request of [
    meta("kitsu:12625"), meta("mal:33950"), meta("anilist:87528"),
    meta("tt7441658", { type: "movie" }), meta("tt7441658", { animeFormat: "SPECIAL" }),
  ]) assert.equal(await h.resolveDetailAnimeEntry(12625, request, null), 12625);
  assert.equal(h.calls.related, 0);
});

test("missing request context does not guess a replacement", async () => {
  const h = fixture();
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(undefined, { releaseInfo: undefined }), null), 12625);
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(undefined, { name: "" }), null), 12625);
  assert.equal(h.calls.related, 0);
});

for (const field of ["title", "year", "subtype", "tmdb", "imdb", "kitsu", "missing mapping"]) {
  test("a related candidate with conflicting " + field + " is rejected", async () => {
    const h = fixture();
    const candidate = h.anime.get(13209)!;
    const mapping = h.mappings.get(13209)!.mappings!;
    if (field === "title") { candidate.title = "Other Show"; candidate.altTitles = []; }
    if (field === "year") candidate.year = "2018";
    if (field === "subtype") candidate.subtype = "movie";
    if (field === "tmdb") mapping.themoviedb_id = 123;
    if (field === "imdb") mapping.imdb_id = "tt999";
    if (field === "kitsu") mapping.kitsu_id = 123;
    if (field === "missing mapping") h.mappings.clear();
    const request = meta(field === "imdb" ? "tt7441658" : undefined);
    assert.deepEqual(await detect(h, request), []);
  });
}

test("multiple verified TV entries are ambiguous", async () => {
  const h = fixture();
  h.anime.set(999, { ...tv, id: 999 });
  h.related.push({ role: "other", meta: meta("kitsu:999") });
  h.mappings.set(999, { mappings: { ...tvMapping.mappings, kitsu_id: 999 } });
  assert.deepEqual(await detect(h, meta()), []);
});

test("duplicate relations do not create ambiguity and spinoffs are not candidates", async () => {
  const h = fixture();
  h.related.push({ role: "parent_story", meta: meta("kitsu:13209") });
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(), null), 13209);
  h.related.splice(0, h.related.length, { role: "spinoff", meta: meta("kitsu:13209") });
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(), null), null);
});

for (const failure of ["related", "candidate", "mapping"]) {
  test("a provider failure during " + failure + " retains the original series path", async () => {
    const h = fixture();
    h.fail(failure);
    assert.deepEqual(await detect(h, meta()), []);
  });
}

test("candidate work is bounded and an oversized result is not partially accepted", async () => {
  const h = fixture();
  for (let id = 20000; id < 20012; id += 1) h.related.push({ role: "other", meta: meta("kitsu:" + id) });
  assert.equal(await h.resolveDetailAnimeEntry(12625, meta(), null), null);
  assert.deepEqual(h.calls.mappings, []);
});

test("a recorded special is validated before entering the anime view", async () => {
  const h = fixture();
  assert.deepEqual(await detect(h, meta(), "kitsu:12625"), [13209]);
  assert.equal(h.calls.external, 0);
});

test("a verified recorded TV entry skips provider resolution and the legacy year gate", async () => {
  const h = fixture();
  assert.deepEqual(await detect(h, meta(), "kitsu:13209"), [13209]);
  assert.equal(h.calls.external, 0);
  assert.equal(h.calls.verdicts, 0);
});

test("an unverified recorded special retains the original series path", async () => {
  const h = fixture();
  h.mappings.clear();
  assert.deepEqual(await detect(h, meta(), "kitsu:12625"), []);
  assert.equal(h.calls.external, 0);
});
