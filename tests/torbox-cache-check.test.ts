import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const HASH = (n: number) => n.toString(16).padStart(40, "0");

type Call = { method: string; url: string; hashes: string[] };

function load(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const mocks: Record<string, unknown> = {
    "@/lib/debug": { dlog() {}, dwarn() {} },
    "@/lib/streams/episode-file": { matchEpisodeFileIndex: () => null },
    "./types": { hashFromMagnet: (x: string) => x, magnetFromHash: (x: string) => x },
    "@/lib/safe-fetch": {
      safeFetch: async (url: string, init: { method?: string; body?: string } = {}) => {
        const method = init.method ?? "GET";
        const hashes =
          method === "POST" ? JSON.parse(init.body!).hashes : new URL(url).searchParams.getAll("hash");
        const call = { method, url, hashes };
        calls.push(call);
        const { status, body } = respond(call);
        return { ok: status < 400, status, json: async () => body, text: async () => "" };
      },
    },
  };
  const compiled = ts.transpileModule(readFileSync("src/lib/debrid/torbox.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(Object.hasOwn(mocks, id), `Unexpected dependency: ${id}`);
    return mocks[id];
  }, exports);
  return { store: exports.createTorbox("key"), calls };
}

const cachedEvenHashes = (call: Call) => ({
  status: 200,
  body: {
    success: true,
    data: Object.fromEntries(
      call.hashes.filter((h) => parseInt(h, 16) % 2 === 0).map((h) => [h, { hash: h }]),
    ),
  },
});

test("checks 2,500 hashes in three POSTs", async () => {
  const { store, calls } = load(cachedEvenHashes);
  const hashes = Array.from({ length: 2500 }, (_, i) => HASH(i + 1));
  const r = await store.cacheCheck(hashes, new AbortController().signal);
  assert.deepEqual(calls.map((c) => [c.method, c.hashes.length]), [["POST", 1000], ["POST", 1000], ["POST", 500]]);
  assert.ok(calls.every((c) => c.url.includes("format=object") && c.url.includes("list_files=false")));
  assert.equal(Object.keys(r.data).length, 1250);
});

test("a failed POST falls back to 25-hash GETs", async () => {
  const { store, calls } = load((call) =>
    call.method === "POST" ? { status: 405, body: { detail: "method-not-allowed" } } : cachedEvenHashes(call),
  );
  const hashes = Array.from({ length: 60 }, (_, i) => HASH(i + 1));
  const r = await store.cacheCheck(hashes, new AbortController().signal);
  assert.deepEqual(calls.map((c) => [c.method, c.hashes.length]), [["POST", 60], ["GET", 25], ["GET", 25], ["GET", 10]]);
  assert.equal(Object.keys(r.data).length, 30);
});

test("rate limiting does not trigger a GET burst", async () => {
  const { store, calls } = load(() => ({ status: 429, body: null }));
  const r = await store.cacheCheck([HASH(1), HASH(2)], new AbortController().signal);
  assert.deepEqual(calls.map((c) => c.method), ["POST"]);
  assert.deepEqual(r, { ok: true, data: {} });
});
