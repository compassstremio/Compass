import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLivePlaybackSrc } from "../src/lib/player/live-src.ts";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("Easynews catalog files remain VOD while explicit broadcasts remain live", () => {
  for (const type of ["movie", "series", "tv", "channel"]) {
    assert.equal(
      isLivePlaybackSrc({ meta: { type, addonOrigin: { name: "Easynews Search" } } }),
      false,
    );
    assert.equal(
      isLivePlaybackSrc({ meta: { type }, streamRef: { addonId: "community.easynews" } }),
      false,
    );
  }
  assert.equal(isLivePlaybackSrc({ meta: { type: "tv" }, isLive: false }), false);
  assert.equal(isLivePlaybackSrc({ meta: { type: "tv" } }), true);
  assert.equal(
    isLivePlaybackSrc({ meta: { id: "iptv:fixture", type: "tv" }, isLive: false }),
    true,
  );
  assert.equal(isLivePlaybackSrc({ meta: { type: "movie" }, isLive: true }), true);
});

test("non-browser-ready file URLs are not mistaken for live MPEG-TS", () => {
  const source = read("src/lib/player/html5/bridge.ts");
  const assignment = source.match(/isLiveSrc = src\.[^;]+;/)[0];
  const start = source.indexOf("      const bare = src.url.toLowerCase()");
  const end = source.indexOf("      if (isHls && Hls.isSupported())", start);
  const classify = new Function(
    "src",
    "let isLiveSrc;" + assignment + source.slice(start, end) + ";return {isLiveSrc,isTs,isHls};",
  );
  assert.deepEqual(
    classify({ url: "https://files.example/download/fixture", notWebReady: true, isLive: false }),
    { isLiveSrc: false, isTs: false, isHls: false },
  );
  assert.deepEqual(
    classify({ url: "https://tv.example/channel", notWebReady: true, isLive: true }),
    { isLiveSrc: true, isTs: true, isHls: false },
  );
  assert.deepEqual(classify({ url: "https://files.example/movie.ts", isLive: false }), {
    isLiveSrc: false,
    isTs: true,
    isHls: false,
  });
});

test("an in-place stream switch declares liveness for the stream it loads", () => {
  const source = read("src/views/player/hooks/use-stream-switcher.ts");
  const start = source.indexOf("await b.load({");
  assert.ok(start > 0, "the switcher must load through the bridge");
  const load = source.slice(start, source.indexOf("});", start));
  // The bridge no longer infers live from notWebReady, so every load path has to
  // say it. The switcher classifies the incoming stream the way the picker does.
  assert.match(load, /isLive: isLivePlaybackSrc\(/);
});
