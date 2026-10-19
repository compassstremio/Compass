// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import { streamSubtitles } from "../src/lib/streams/stream-subtitles.ts";

test("stream subtitles from a local addon carry its trust", () => {
  const seeds = streamSubtitles({
    addonUrl: "http://127.0.0.1:7000",
    subtitles: [
      { url: "http://127.0.0.1:7000/subs/a.srt", lang: "en", id: "a" },
      { url: "http://127.0.0.1:7000/subs/b.srt", lang: "fr" },
    ],
  });
  assert.equal(seeds?.length, 2);
  assert.deepEqual(seeds?.[0], {
    url: "http://127.0.0.1:7000/subs/a.srt",
    lang: "en",
    id: "a",
    trustedSource: true,
  });
  assert.equal(seeds?.[1].url, "http://127.0.0.1:7000/subs/b.srt");
  assert.equal(seeds?.[1].trustedSource, true);
});

test("stream subtitles from a public addon stay public-only", () => {
  const seeds = streamSubtitles({
    addonUrl: "https://addon.example.com",
    subtitles: [{ url: "https://cdn.example.com/a.srt", lang: "en" }],
  });
  assert.equal(seeds?.length, 1);
  assert.notEqual(seeds?.[0].trustedSource, true);
  // A public addon cannot smuggle a loopback subtitle URL into the player's
  // local-trust path.
  const smuggled = streamSubtitles({
    addonUrl: "https://addon.example.com",
    subtitles: [{ url: "http://127.0.0.1:8080/secret.srt" }],
  });
  assert.equal(smuggled?.[0].url, "http://127.0.0.1:8080/secret.srt");
  assert.notEqual(smuggled?.[0].trustedSource, true);
});

test("a local addon's subtitle on another origin is not trusted", () => {
  const seeds = streamSubtitles({
    addonUrl: "http://127.0.0.1:7000",
    subtitles: [{ url: "http://127.0.0.1:9000/a.srt" }],
  });
  assert.equal(seeds?.[0].url, "http://127.0.0.1:9000/a.srt");
  assert.notEqual(seeds?.[0].trustedSource, true);
});

test("streams without subtitles stay undefined", () => {
  assert.equal(streamSubtitles({ addonUrl: "http://127.0.0.1:7000" }), undefined);
});

test("loopback aliases of one addon count as the same origin", () => {
  const seeds = streamSubtitles({
    addonUrl: "http://localhost:7000",
    subtitles: [{ url: "http://127.0.0.1:7000/a.srt", lang: "en" }],
  });
  assert.equal(seeds?.[0].trustedSource, true);
});
