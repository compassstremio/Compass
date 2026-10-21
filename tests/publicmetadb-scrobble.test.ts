import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import { clearPmdbMappingsCache } from "../src/lib/publicmetadb/mappings.ts";
import { pmdbDeleteResumeForTarget, pmdbSaveResume } from "../src/lib/publicmetadb/scrobble.ts";
import { setSession } from "../src/lib/publicmetadb/session.ts";
import type { PmdbTarget } from "../src/lib/publicmetadb/types.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function fixture(handler: (url: string, init: RequestInit) => Response) {
  localStorage.clear();
  clearPmdbMappingsCache();
  setSession({ apiKey: "pm-testkey", validatedAt: Date.now() });
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET" });
    return handler(url, init);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; setSession(null); },
  };
}

for (const media of ["movie", "tv"] as const) {
  test(`resume cleanup requires the same ${media} identity and coordinates`, async () => {
    const target: PmdbTarget = { tmdb_id: 550, media_type: media, ...(media === "tv" ? { season: 1, episode: 2 } : {}) };
    const coords = media === "tv" ? { season: 1, episode: 2 } : { season: 0, episode: 0 };
    const h = fixture((_url, init) => init.method === "DELETE"
      ? new Response(null, { status: 204 })
      : json({ items: [
          { id: "other-title", tmdb_id: 999, media_type: media, ...coords },
          { id: "other-media", tmdb_id: 550, media_type: media === "tv" ? "movie" : "tv", ...coords },
          { id: "other-episode", tmdb_id: 550, media_type: media, season: 3, episode: 4 },
          { id: "correct", tmdb_id: 550, media_type: media, ...coords },
        ], totalPages: 1 }));
    try {
      assert.equal(await pmdbDeleteResumeForTarget(target), true);
      assert.deepEqual(h.calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/").pop()), ["correct"]);
    } finally { h.restore(); }
  });
}

test("resume cleanup never deletes an unrelated point when the title is absent", async () => {
  const h = fixture(() => json({ items: [{ id: "other", tmdb_id: 999, media_type: "movie" }], totalPages: 1 }));
  try {
    assert.equal(await pmdbDeleteResumeForTarget({ tmdb_id: 550, media_type: "movie" }), false);
    assert.ok(h.calls.every((c) => c.method === "GET"));
  } finally { h.restore(); }
});

test("ID-only cleanup resolves TMDB identity before selecting a resume", async () => {
  const h = fixture((url, init) => {
    if (url.includes("/mappings/lookup")) return json({ tmdb_id: 550, media_type: "movie" });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return json({ items: [
      { id: "other", tmdb_id: 999, media_type: "movie" },
      { id: "correct", tmdb_id: 550, media_type: "movie" },
    ], totalPages: 1 });
  });
  try {
    assert.equal(await pmdbDeleteResumeForTarget({ id_type: "imdb", id_value: "tt0137523", media_type: "movie" }), true);
    assert.ok(h.calls.at(-1)?.url.endsWith("/correct"));
  } finally { h.restore(); }
});

for (const mapping of [null, { tmdb_id: 550, media_type: "tv" }]) {
  test(`unresolved or mismatched mapping cannot delete a movie resume (${JSON.stringify(mapping)})`, async () => {
    const h = fixture(() => json(mapping, mapping ? 200 : 404));
    try {
      assert.equal(await pmdbDeleteResumeForTarget({ id_type: "imdb", id_value: "tt0137523", media_type: "movie" }), false);
      assert.equal(h.calls.length, 1);
      assert.ok(h.calls[0].url.includes("/mappings/lookup"));
    } finally { h.restore(); }
  });
}

test("409 recovery deletes only the matching point before retrying the save", async () => {
  let posts = 0;
  const h = fixture((_url, init) => {
    if (init.method === "POST") return ++posts === 1 ? json({}, 409) : json({ action: "saved" });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return json({ items: [
      { id: "other", tmdb_id: 999, media_type: "movie" },
      { id: "correct", tmdb_id: 550, media_type: "movie" },
    ], totalPages: 1 });
  });
  try {
    assert.equal((await pmdbSaveResume({ tmdb_id: 550, media_type: "movie" }, 60_000, 600_000))?.action, "saved");
    assert.equal(posts, 2);
    assert.deepEqual(h.calls.filter((c) => c.method === "DELETE").map((c) => c.url.split("/").pop()), ["correct"]);
  } finally { h.restore(); }
});
