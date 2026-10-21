import test from "node:test";
import assert from "node:assert/strict";
import { MANGA_PAGE } from "../src/lib/manga/types.ts";
import {
  COMPASS_MANGA_URL,
  hostedSourceId,
  hostedSourcesSync,
  makeHostedProvider,
  mangaKeyState,
  refreshHostedSources,
  removeMangaKey,
  saveMangaKey,
  savedKeyPrefix,
  sourcesForLanguage,
  toHostedSources,
} from "../src/lib/manga/sources/compass-hosted.ts";

const SOURCE = { id: "3asq", name: "مانجا العاشق", lang: "ar" };
const KEY = "cmp_" + "a".repeat(43);
const withKey = () => KEY;
const realFetch = globalThis.fetch;

type Seen = { url: string; key: string | null };

function stubFetch(answer: (url: string, key: string | null) => { status?: number; body: unknown }): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = new Headers(init?.headers).get("x-compass-key");
    seen.push({ url, key });
    const { status = 200, body } = answer(url, key);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  removeMangaKey();
});

test("every request carries the key, and browse pages by the grid's page size", async () => {
  const seen = stubFetch(() => ({ body: { items: [{ id: "island-rock", title: "Island rock" }], hasMore: true } }));
  const p = makeHostedProvider(SOURCE, withKey);
  const items = await p.popular(MANGA_PAGE);
  assert.equal(p.id, hostedSourceId("3asq"));
  assert.deepEqual(items.map((m) => m.id), ["island-rock"]);
  assert.equal(seen[0].key, KEY);
  const url = new URL(seen[0].url);
  assert.equal(url.origin + url.pathname, `${COMPASS_MANGA_URL}/api/3asq/popular`);
  assert.equal(url.searchParams.get("offset"), String(MANGA_PAGE));
  assert.equal(url.searchParams.get("limit"), String(MANGA_PAGE));
});

test("without a key nothing is requested", async () => {
  const seen = stubFetch(() => ({ body: {} }));
  await assert.rejects(makeHostedProvider(SOURCE, () => null).popular(0), /Compass Manga key/);
  assert.equal(seen.length, 0);
});

test("saving a key: malformed is caught locally, a refused key is not kept, an accepted one is", async () => {
  const seen = stubFetch((url, key) => (url.endsWith("/api/key") && key === KEY ? { body: { ok: true } } : { status: 401, body: {} }));
  assert.equal(await saveMangaKey("not a key"), "malformed");
  assert.equal(seen.length, 0);
  assert.equal(await saveMangaKey("cmp_" + "z".repeat(43)), "rejected");
  assert.equal(mangaKeyState(), "missing");
  assert.equal(await saveMangaKey(`  ${KEY} `), "saved");
  assert.equal(seen.find((s) => s.url.endsWith("/api/key") && s.key === KEY)?.url, `${COMPASS_MANGA_URL}/api/key`);
  assert.equal(mangaKeyState(), "saved");
  assert.equal(savedKeyPrefix(), KEY.slice(0, 8));
});

test("an unreachable server does not save the key", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("offline");
  }) as typeof fetch;
  assert.equal(await saveMangaKey(KEY), "unreachable");
  assert.equal(mangaKeyState(), "missing");
});

test("a key reset on the account page: the next 401 marks it rejected and hides the sources", async () => {
  stubFetch((url) => (url.endsWith("/api/key") ? { body: { ok: true } } : { status: 401, body: {} }));
  assert.equal(await saveMangaKey(KEY), "saved");
  await assert.rejects(makeHostedProvider(SOURCE).popular(0), /401/);
  assert.equal(mangaKeyState(), "rejected");
  assert.deepEqual(hostedSourcesSync(), []);
  removeMangaKey();
  assert.equal(mangaKeyState(), "missing");
});

test("a genre with no query browses that genre instead of searching for nothing", async () => {
  const seen = stubFetch(() => ({ body: { items: [] } }));
  await makeHostedProvider(SOURCE, withKey).search("  ", 0, "drama");
  const url = new URL(seen[0].url);
  assert.equal(url.pathname, "/api/3asq/popular");
  assert.equal(url.searchParams.get("tag"), "drama");
});

test("chapters carry the source language so the language filter can see them", async () => {
  stubFetch(() => ({ body: { items: [{ id: "island-rock/15", chapter: "15", publishAt: "2026-10-21T03:43:31.000Z" }] } }));
  const [c] = await makeHostedProvider(SOURCE, withKey).chapters("island-rock");
  assert.equal(c.id, "island-rock/15");
  assert.equal(c.language, "ar");
});

test("ids that are not path segments never reach the network", async () => {
  const seen = stubFetch(() => ({ body: {} }));
  const p = makeHostedProvider(SOURCE, withKey);
  assert.deepEqual(await p.pageUrls("../../etc"), []);
  assert.deepEqual(await p.pageUrls("a/b/c"), []);
  assert.equal(await p.detail("a/b"), null);
  assert.deepEqual(await p.chapters("a b"), []);
  assert.equal(seen.length, 0);
});

test("a missing series is null, a server failure is an error", async () => {
  stubFetch(() => ({ status: 404, body: { error: "not found" } }));
  assert.equal(await makeHostedProvider(SOURCE, withKey).detail("gone"), null);
  stubFetch(() => ({ status: 502, body: { error: "source unavailable" } }));
  await assert.rejects(makeHostedProvider(SOURCE, withKey).popular(0));
});

test("page URLs are kept only when they are http(s)", async () => {
  stubFetch(() => ({ body: { pages: ["https://3asq.online/wp-content/uploads/0.png", "javascript:alert(1)"] } }));
  assert.deepEqual(await makeHostedProvider(SOURCE, withKey).pageUrls("island-rock/15"), [
    "https://3asq.online/wp-content/uploads/0.png",
  ]);
});

test("no key, no hosted sources; the list refresh sends no key and survives a failure", async () => {
  assert.deepEqual(hostedSourcesSync(), []);
  const seen = stubFetch(() => ({ status: 503, body: {} }));
  await refreshHostedSources();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${COMPASS_MANGA_URL}/api/sources`);
  assert.equal(seen[0].key, null);
});

test("a source is listed only for readers whose interface is in its language", () => {
  const list = [
    { id: "3asq", name: "مانجا العاشق", lang: "ar" },
    { id: "jp", name: "JP", lang: "ja" },
    { id: "any", name: "Any", lang: "" },
  ];
  assert.deepEqual(sourcesForLanguage(list, "ar").map((s) => s.id), ["3asq", "any"]);
  assert.deepEqual(sourcesForLanguage(list, "ar-SA").map((s) => s.id), ["3asq", "any"]);
  assert.deepEqual(sourcesForLanguage(list, "en").map((s) => s.id), ["any"]);
  assert.deepEqual(sourcesForLanguage([{ id: "x", name: "X", lang: "AR" }], "ar").map((s) => s.id), ["x"]);
});

test("the server's source list is validated", () => {
  assert.deepEqual(
    toHostedSources([{ id: "3asq", name: "مانجا العاشق", lang: "ar", icon: "http://x/i.png" }, { id: "../x", name: "bad" }, { id: "ok" }]),
    [{ id: "3asq", name: "مانجا العاشق", lang: "ar", icon: undefined }],
  );
  assert.deepEqual(toHostedSources(null), []);
});
