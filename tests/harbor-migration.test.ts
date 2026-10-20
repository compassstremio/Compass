import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptHarborSettingsFields,
  migrateHarborStorage,
  renameHarborKey,
} from "../src/lib/harbor-migration.ts";

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test("Harbor keys map onto Compass names and nothing else is renamed", () => {
  assert.equal(renameHarborKey("harbor.trakt.session.v1.p_1"), "compass.trakt.session.v1.p_1");
  assert.equal(renameHarborKey("harbor-theme"), "compass-theme");
  assert.equal(renameHarborKey("harborColor"), "compassColor");
  assert.equal(renameHarborKey("harborcommunity"), null);
  assert.equal(renameHarborKey("compass.settings"), null);
});

test("an imported Harbor profile moves to Compass keys and flags its databases", () => {
  const storage = memoryStorage({
    "harbor.settings": "{}",
    "harbor.profiles.v1": "[1]",
    unrelated: "x",
  });

  assert.equal(migrateHarborStorage(storage), 2);

  assert.deepEqual(Object.fromEntries(storage.map), {
    "compass.settings": "{}",
    "compass.profiles.v1": "[1]",
    unrelated: "x",
    "compass.harbor-import.idb-pending.v1": "1",
  });
});

test("a key Compass already holds is never overwritten by Harbor's copy", () => {
  const storage = memoryStorage({
    "harbor.settings": "old",
    "compass.settings": "current",
  });

  assert.equal(migrateHarborStorage(storage), 0);

  assert.equal(storage.getItem("compass.settings"), "current");
  assert.equal(storage.getItem("harbor.settings"), "old");
  assert.equal(storage.getItem("compass.harbor-import.idb-pending.v1"), null);
});

test("Harbor-named settings fields become their Compass fields", () => {
  const parsed: Record<string, unknown> = {
    harborColor: "#ffffff",
    harborAvatar: "avatar.webp",
    homeMode: "harbor",
    togetherRelayUrl: "wss://harbor-together-relay.example.workers.dev",
    tmdbKey: "key",
  };

  adoptHarborSettingsFields(parsed);

  assert.deepEqual(parsed, {
    compassColor: "#ffffff",
    compassAvatar: "avatar.webp",
    homeMode: "compass",
    togetherRelayUrl: "",
    tmdbKey: "key",
  });
});

test("Compass settings fields win over Harbor's and a custom relay is kept", () => {
  const parsed: Record<string, unknown> = {
    harborColor: "#000000",
    compassColor: "#ffffff",
    homeMode: "classic",
    togetherRelayUrl: "wss://relay.example.com",
  };

  adoptHarborSettingsFields(parsed);

  assert.deepEqual(parsed, {
    compassColor: "#ffffff",
    homeMode: "classic",
    togetherRelayUrl: "wss://relay.example.com",
  });
});
