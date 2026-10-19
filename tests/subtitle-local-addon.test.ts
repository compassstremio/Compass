// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  isLocalAddonSubtitleUrl,
  isSafeProviderSubtitleUrl,
} from "../src/lib/subtitles/provider-url.ts";
import { deduplicateAndRankSubtitleResults } from "../src/lib/subtitles/search.ts";
import { subtitleLoadMetadataOf } from "../src/lib/subtitles/provider-label.ts";
import { prepareSubtitle } from "../src/lib/subtitles/prepare.ts";
import {
  rememberedChoiceFromLoad,
  rememberedFromChoice,
  rememberedSubtitleLoadMetadata,
  type RememberedSub,
} from "../src/lib/subtitles/subtitle-memory.ts";
import type { SubResult } from "../src/lib/subtitles/types.ts";

test("only same-origin subtitles of a user-installed local addon are locally trusted", () => {
  const localBase = "http://127.0.0.1:7000";
  assert.equal(isLocalAddonSubtitleUrl(`${localBase}/subtitles/a.srt`, localBase), true);
  assert.equal(isLocalAddonSubtitleUrl("http://localhost:7000/a.srt", "http://localhost:7000"), true);
  assert.equal(isLocalAddonSubtitleUrl("http://192.168.1.5:7000/a.srt", "http://192.168.1.5:7000"), true);
  assert.equal(isLocalAddonSubtitleUrl("http://10.0.0.5:7000/a.srt", "http://10.0.0.5:7000"), true);
  assert.equal(isLocalAddonSubtitleUrl("http://[::1]:7000/a.srt", "http://[::1]:7000"), true);
  // The loopback aliases are one host: an addon installed as one alias can serve
  // subtitles under another.
  assert.equal(isLocalAddonSubtitleUrl("http://127.0.0.1:7000/a.srt", "http://localhost:7000"), true);
  assert.equal(isLocalAddonSubtitleUrl("http://[::1]:7000/a.srt", "http://127.0.0.1:7000"), true);

  // DNS names cannot be judged from their shape - `.local`/`.lan`/`.internal`
  // may resolve anywhere - so they never grant the local-network exemption.
  assert.equal(isLocalAddonSubtitleUrl("http://myaddon.local:7000/a.srt", "http://myaddon.local:7000"), false);
  assert.equal(
    isLocalAddonSubtitleUrl("http://media.home.arpa:7000/a.srt", "http://media.home.arpa:7000"),
    false,
  );
  // Routable-but-reserved ranges are not the user's local network either.
  assert.equal(isLocalAddonSubtitleUrl("http://100.64.0.5:7000/a.srt", "http://100.64.0.5:7000"), false);
  assert.equal(isLocalAddonSubtitleUrl("http://198.18.0.1:7000/a.srt", "http://198.18.0.1:7000"), false);

  // The addon must itself be non-public: a public addon never gains local reach.
  assert.equal(
    isLocalAddonSubtitleUrl("http://127.0.0.1:7000/a.srt", "https://addon.example.com"),
    false,
  );
  assert.equal(isLocalAddonSubtitleUrl("https://addon.example.com/a.srt", "https://addon.example.com"), false);
  // Same host, different origin (port or scheme) stays out of trust.
  assert.equal(isLocalAddonSubtitleUrl("http://127.0.0.1:7001/a.srt", localBase), false);
  assert.equal(isLocalAddonSubtitleUrl("https://127.0.0.1:7000/a.srt", localBase), false);
  // Credentials and non-HTTP schemes are rejected outright.
  assert.equal(isLocalAddonSubtitleUrl("http://user:pass@127.0.0.1:7000/a.srt", localBase), false);
  assert.equal(isLocalAddonSubtitleUrl("file:///tmp/a.srt", localBase), false);
  assert.equal(isLocalAddonSubtitleUrl("not a url", localBase), false);

  // The public-only helper is untouched: loopback stays provider-unsafe.
  assert.equal(isSafeProviderSubtitleUrl(`${localBase}/a.srt`), false);
});

test("locally trusted results survive ranking while unmarked local URLs are dropped", () => {
  const result = (id: string, url: string, extra: Partial<SubResult> = {}): SubResult => ({
    id,
    url,
    lang: "en",
    source: "addon",
    ...extra,
  });
  const ranked = deduplicateAndRankSubtitleResults(
    [
      result("local", "http://127.0.0.1:7000/a.srt", { localTrusted: true }),
      result("public", "https://cdn.example.com/a.srt"),
      result("unmarked", "http://127.0.0.1:7000/b.srt"),
      result("lan", "http://192.168.1.5:7000/c.srt"),
    ],
    ["en"],
  );
  assert.deepEqual(
    ranked.map((r) => r.id).sort(),
    ["local", "public"],
  );
});

test("local-addon subtitles map to non-provider metadata with local trust", () => {
  const local: SubResult = {
    id: "l",
    url: "http://127.0.0.1:7000/subtitles/a.srt",
    lang: "en",
    source: "addon",
    title: "Local addon",
    localTrusted: true,
  };
  const meta = subtitleLoadMetadataOf(local);
  assert.equal(meta.localTrusted, true);
  assert.equal(meta.providerDerived, false);

  const remote = subtitleLoadMetadataOf({ ...local, localTrusted: undefined });
  assert.equal(remote.localTrusted, undefined);
  assert.equal(remote.providerDerived, undefined);
});

test("remembered local-addon tracks keep their trust across restarts", () => {
  const meta = subtitleLoadMetadataOf({
    id: "l",
    url: "http://127.0.0.1:7000/subtitles/a.srt",
    lang: "en",
    source: "addon",
    localTrusted: true,
  });
  const remembered = {
    ...rememberedFromChoice(
      rememberedChoiceFromLoad("http://127.0.0.1:7000/subtitles/a.srt", "en", "Local", meta),
    ),
    updatedAt: 1,
  } satisfies RememberedSub;
  const restored = rememberedSubtitleLoadMetadata(remembered);
  assert.equal(restored.localTrusted, true);
  assert.equal(restored.providerDerived, false);
});

test("prepared subtitle downloads forward the local-network opt-in per track", async () => {
  const english = `1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:04,000 --> 00:00:05,500\nWorld\n`;
  const calls: Array<boolean | undefined> = [];
  const fetchBytes = async (
    _url: string,
    _signal: AbortSignal,
    _timeout: number,
    _headers?: Record<string, string>,
    _maxBytes?: number,
    allowLocalNetwork?: boolean,
  ) => {
    calls.push(allowLocalNetwork);
    return new Response(english, { status: 200 });
  };
  const createPlayable = async (bytes: Uint8Array, format: string) => ({
    url: `memory:${format}:${bytes.length}`,
    cleanup: () => {},
  });

  await prepareSubtitle(
    { url: "http://127.0.0.1:7000/subtitles/a.srt", allowLocalNetwork: true },
    { fetchBytes, createPlayable },
  );
  await prepareSubtitle(
    { url: "https://cdn.example.com/a.srt" },
    { fetchBytes, createPlayable },
  );
  assert.deepEqual(calls, [true, false]);
});

test("the local-addon trust path is wired through every fetch choke point", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  const addons = read("src/lib/subtitles/providers/addons.ts");
  assert.match(addons, /isLocalNetworkUrl\(base\) \? safeFetchLocal : fetch/);
  assert.match(addons, /isLocalAddonSubtitleUrl\(s\.url, addonBase\)/);
  assert.match(addons, /localTrusted \? \{ localTrusted: true \} : \{\}/);

  const fetchIntoPlayer = read("src/lib/subtitles/fetch-into-player.ts");
  assert.match(
    fetchIntoPlayer,
    /result\.localTrusted === true \|\| isSafeProviderSubtitleUrl\(result\.url\)/,
  );
  assert.match(fetchIntoPlayer, /allowLocalNetwork: result\.localTrusted === true/);
  assert.match(fetchIntoPlayer, /result\.localTrusted !== true/);

  const prepare = read("src/lib/subtitles/prepare.ts");
  assert.match(prepare, /input\.allowLocalNetwork === true/);

  const safeFetch = read("src/lib/safe-fetch.ts");
  assert.match(
    safeFetch,
    /tauriCompassFetch\(target, init, "base64", timeoutMs, maxResponseBytes, allowLocalNetwork\)/,
  );

  const mpv = read("src/lib/player/mpv.ts");
  assert.match(mpv, /allowLocalNetwork: metadata\?\.localTrusted === true/);

  const bridge = read("src/lib/player/html5/bridge.ts");
  assert.match(bridge, /allowLocalNetwork: track\.metadata\?\.localTrusted === true/);

  const resolve = read("src/lib/streams/resolve.ts");
  assert.match(resolve, /streamSubtitles\(stream\)/);
  const streamSeeds = read("src/lib/streams/stream-subtitles.ts");
  assert.match(streamSeeds, /isLocalAddonSubtitleUrl\(s\.url, stream\.addonUrl\)/);
  assert.match(mpv, /allowLocalNetwork: subtitle\.trustedSource === true/);
  assert.match(bridge, /localTrusted: s\.trustedSource === true/);
});
