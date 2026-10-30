import assert from "node:assert/strict";
import test from "node:test";
import { aiTranslateProvider, attachTranslations, createLyricTranslationCache, myMemoryProvider, translateLyricLines, type TranslateProvider } from "../src/lib/music/lyric-translation.ts";

const lines = [{ at: 1.5, text: "Hola mundo" }, { at: 4, text: "" }, { at: 7.25, text: "Adiós" }];
const ok = (name: string, map: (t: string) => string): TranslateProvider => ({ name, translate: async texts => texts.map(map) });
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

test("translation is aligned by index and never changes timestamps", async () => {
  const result = await translateLyricLines(lines, "en", [ok("fake", t => t.toUpperCase())]);
  assert.ok(result.ok);
  assert.deepEqual(result.lines, ["HOLA MUNDO", "", "ADIÓS"]);
  const merged = attachTranslations(lines, result.lines);
  assert.deepEqual(merged.map(l => l.at), [1.5, 4, 7.25]);
  assert.deepEqual(merged.map(l => l.text), ["Hola mundo", "", "Adiós"]);
  assert.deepEqual(merged.map(l => l.translation), ["HOLA MUNDO", undefined, "ADIÓS"]);
});

test("only non-empty lines are sent and falls through to the next provider on failure or length mismatch", async () => {
  const sent: string[][] = [];
  const broken: TranslateProvider = { name: "broken", translate: async () => { throw new Error("down"); } };
  const short: TranslateProvider = { name: "short", translate: async texts => { sent.push(texts); return texts.slice(1); } };
  const good: TranslateProvider = { name: "good", translate: async texts => { sent.push(texts); return texts.map(t => `[${t}]`); } };
  const result = await translateLyricLines(lines, "en", [broken, short, good]);
  assert.ok(result.ok && result.provider === "good");
  assert.deepEqual(sent[1], ["Hola mundo", "Adiós"]);
});

test("reports typed failures for no providers, no text, unsupported language and total failure", async () => {
  const fail: TranslateProvider = { name: "x", translate: async () => { throw new Error("nope"); } };
  assert.deepEqual(await translateLyricLines(lines, "en", []), { ok: false, reason: "no-provider" });
  assert.deepEqual(await translateLyricLines([{ at: 0, text: " " }], "en", [fail]), { ok: false, reason: "no-text" });
  assert.deepEqual(await translateLyricLines(lines, "xx-invalid!", [fail]), { ok: false, reason: "unsupported" });
  assert.deepEqual(await translateLyricLines(lines, "en", [fail]), { ok: false, reason: "failed" });
});

test("AI provider parses a JSON array, tolerates code fences and rejects garbage or HTTP errors", async () => {
  const call = (content: string, status = 200) => aiTranslateProvider({ key: "k", model: "m", isGroq: false, fetchImpl: reply({ choices: [{ message: { content } }] }, status) as never }).translate(["a", "b"], "en");
  assert.deepEqual(await call('["x","y"]'), ["x", "y"]);
  assert.deepEqual(await call('```json\n["x","y"]\n```'), ["x", "y"]);
  await assert.rejects(call("not json"));
  await assert.rejects(call('["only one"]'));
  await assert.rejects(call('["x","y"]', 401));
});

test("AI provider never sends the key anywhere except the provider endpoint", async () => {
  const seen: { url: string; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, auth: (init.headers as Record<string, string>).Authorization }); return new Response(JSON.stringify({ choices: [{ message: { content: '["x"]' } }] })); }) as never;
  await aiTranslateProvider({ key: " secret ", model: "m", isGroq: true, fetchImpl }).translate(["a"], "en");
  assert.equal(seen[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(seen[0].auth, "Bearer secret");
});

test("MyMemory provider translates per line and surfaces quota errors", async () => {
  const fetchImpl = (async (url: string) => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `T:${new URL(url).searchParams.get("q")}` } }))) as never;
  assert.deepEqual(await myMemoryProvider({ fetchImpl }).translate(["a", "b"], "en"), ["T:a", "T:b"]);
  const quota = (async () => new Response(JSON.stringify({ responseStatus: 429, responseData: { translatedText: "LIMIT" } }))) as never;
  await assert.rejects(myMemoryProvider({ fetchImpl: quota }).translate(["a"], "en"));
});

test("cache keys include track and language and evict oldest", () => {
  const cache = createLyricTranslationCache(2);
  cache.set("t1", "en", ["a"]); cache.set("t1", "fr", ["b"]); cache.set("t2", "en", ["c"]);
  assert.equal(cache.get("t1", "en"), undefined);
  assert.deepEqual(cache.get("t1", "fr"), ["b"]);
  assert.deepEqual(cache.get("t2", "en"), ["c"]);
});
