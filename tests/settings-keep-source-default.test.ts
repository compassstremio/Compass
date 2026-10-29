import assert from "node:assert/strict";
import test from "node:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

const { DEFAULT, STORAGE_KEY } = await import("../src/lib/settings/defaults");
const { loadStoredSettings } = await import("../src/lib/settings/load");

test.beforeEach(() => values.clear());

test("a new install keeps the same source across episodes of a series", () => {
  assert.equal(DEFAULT.keepSourceNextEpisode, true);
  assert.equal(loadStoredSettings().keepSourceNextEpisode, true);
});

test("a user who saved the option off keeps it off", () => {
  values.set(STORAGE_KEY, JSON.stringify({ keepSourceNextEpisode: false }));
  assert.equal(loadStoredSettings().keepSourceNextEpisode, false);
});

test("audio and subtitle language preferences are unchanged", () => {
  assert.deepEqual(DEFAULT.preferredSubLangs, ["English"]);
  assert.deepEqual(DEFAULT.preferredAudioLangs, ["English", "Japanese"]);
});
