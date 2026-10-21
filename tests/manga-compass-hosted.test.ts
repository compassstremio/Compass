import test from "node:test";
import assert from "node:assert/strict";
import { MANGA_PAGE } from "../src/lib/manga/types.ts";
import {
  COMPASS_MANGA_URL,
  hostedSourceId,
  hostedSourcesSync,
  makeHostedProvider,
  refreshHostedSources,
  toHostedSources,
  type KeyGetter,
} from "../src/lib/manga/sources/compass-hosted.ts";

const SOURCE = { id: "3asq", name: "مانجا العاشق", lang: "ar" };
const KEY = "cmp_" + "a".repeat(43);
const NEW_KEY = "cmp_" + "b".repeat(43);
const withKey: KeyGetter = async () => KEY;
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
});

test("every request carries the account key, and browse pages by the grid's page size", async () => {
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
  await assert.rejects(makeHostedProvider(SOURCE, async () => null).popular(0), /sign in/);
  assert.equal(seen.length, 0);
});

test("a key reset elsewhere: a 401 fetches a fresh key and retries once", async () => {
  const seen = stubFetch((_url, key) => (key === NEW_KEY ? { body: { items: [] } } : { status: 401, body: {} }));
  const asked: boolean[] = [];
  const getKey: KeyGetter = async (fresh) => {
    asked.push(!!fresh);
    return fresh ? NEW_KEY : KEY;
  };
  await makeHostedProvider(SOURCE, getKey).tags!();
  assert.deepEqual(asked, [false, true]);
  assert.deepEqual(seen.map((s) => s.key), [KEY, NEW_KEY]);
});

test("a 401 with no newer key is a failure, not a loop", async () => {
  const seen = stubFetch(() => ({ status: 401, body: {} }));
  await assert.rejects(makeHostedProvider(SOURCE, withKey).popular(0), /401/);
  assert.equal(seen.length, 1);
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

test("signed out there are no hosted sources, and a refresh does not throw", async () => {
  assert.deepEqual(hostedSourcesSync(), []);
  const seen = stubFetch(() => ({ status: 503, body: {} }));
  await refreshHostedSources(async () => null);
  await refreshHostedSources(withKey);
  assert.equal(seen.length, 1);
});

test("the server's source list is validated", () => {
  assert.deepEqual(
    toHostedSources([{ id: "3asq", name: "مانجا العاشق", lang: "ar", icon: "http://x/i.png" }, { id: "../x", name: "bad" }, { id: "ok" }]),
    [{ id: "3asq", name: "مانجا العاشق", lang: "ar", icon: undefined }],
  );
  assert.deepEqual(toHostedSources(null), []);
});
