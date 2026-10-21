// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { createHash } from "node:crypto";
import { addonBasesForOrigin, type Addon } from "../src/lib/addons.ts";
import { persistableAddonOrigin, persistableVideos } from "../src/lib/cinemeta.ts";

test("persisted addon origins never retain configured transport URLs", () => {
  const origin = persistableAddonOrigin({
    id: "community.addon",
    name: "Community addon",
    logo: "https://images.example/logo.png",
    base: "https://addon.example/secret-api-key/manifest.json",
  });

  assert.deepEqual(origin, {
    id: "community.addon",
    name: "Community addon",
    logo: "https://images.example/logo.png",
    configurationKey: createHash("sha256").update("https://addon.example/secret-api-key").digest("hex"),
  });
  assert.doesNotMatch(JSON.stringify(origin), /secret-api-key/);
});

test("a saved AIOStreams item prefers its original configuration after installed order changes", () => {
  const first = "https://aio.example/fixture-first";
  const second = "https://aio.example/fixture-second";
  const addons: Addon[] = [first, second].map((base) => ({
    manifest: { id: "community.aiostreams", name: "AIOStreams" },
    transportUrl: `${base}/manifest.json`,
  }));
  const saved = persistableAddonOrigin({
    id: "community.aiostreams",
    name: "AIOStreams",
    base: second,
  });
  const reloaded = persistableAddonOrigin(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(addonBasesForOrigin(addons, reloaded), [second, first]);
  assert.deepEqual(addonBasesForOrigin([...addons].reverse(), reloaded), [second, first]);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-second|aio\.example/);
  assert.equal(addons[1].transportUrl, `${second}/manifest.json`);
});

test("saved catalogue keys still resolve their installed addon without storing its URL", () => {
  const base = "https://addon.example/fixture-credential";
  const saved = persistableAddonOrigin({
    id: "catalogue-key:movie:popular",
    name: "Example catalogue",
    base,
  });
  const addon: Addon = {
    manifest: { id: "community.example", name: "Example" },
    transportUrl: `${base}/manifest.json`,
  };
  assert.deepEqual(addonBasesForOrigin([addon], saved), [base]);
  assert.deepEqual(addonBasesForOrigin([], saved), []);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-credential|addon\.example/);
});

test("configuration changes retain the existing manifest-ID fallback", () => {
  const saved = persistableAddonOrigin({
    id: "community.example",
    name: "Example",
    base: "https://addon.example/old-key/manifest.json",
  });
  const addon: Addon = {
    manifest: { id: "community.example", name: "Example" },
    transportUrl: "https://addon.example/current-key/manifest.json",
  };
  assert.deepEqual(addonBasesForOrigin([addon], saved), ["https://addon.example/current-key"]);
});

test("persisted origins reject network URLs and credential-like suffixes on plugin identifiers", () => {
  for (const base of [
    "https://user:password@addon.example/manifest.json",
    "https://addon.example/manifest.json?token=secret",
    "compass-plugin://plugin:example/provider?token=secret",
    "compass-plugin://user:password@host/provider",
  ]) {
    assert.equal(persistableAddonOrigin({ id: "example", name: "Example", base })?.base, undefined);
  }
  assert.equal(
    persistableAddonOrigin({
      id: "example",
      name: "Example",
      base: "compass-plugin://plugin:example/provider",
    })?.base,
    "compass-plugin://plugin:example/provider",
  );
});

test("persisted video metadata strips playable streams and signed URLs", () => {
  const videos = persistableVideos([
    {
      id: "episode:1",
      season: 1,
      episode: 1,
      title: "Episode 1",
      streams: [
        {
          url: "https://stream.example/private-token/video.mkv",
          behaviorHints: { proxyHeaders: { request: { Authorization: "Bearer private-token" } } },
        },
      ],
    },
  ]);

  assert.deepEqual(videos, [{ id: "episode:1", season: 1, episode: 1, title: "Episode 1" }]);
  assert.doesNotMatch(JSON.stringify(videos), /private-token|stream\.example|Authorization/);
});

test("saved addon identity resolves against current installed addon instances", () => {
  const addons: Addon[] = [
    {
      manifest: { id: "community.addon", name: "First configuration" },
      transportUrl: "https://addon.example/current-key-one/manifest.json",
    },
    {
      manifest: { id: "community.addon", name: "Second configuration" },
      transportUrl: "https://addon.example/current-key-two/manifest.json",
    },
    {
      manifest: { id: "unrelated.addon", name: "Unrelated" },
      transportUrl: "https://unrelated.example/manifest.json",
    },
  ];

  assert.deepEqual(
    addonBasesForOrigin(addons, { id: "community.addon", name: "Community addon" }),
    ["https://addon.example/current-key-one", "https://addon.example/current-key-two"],
  );
});
