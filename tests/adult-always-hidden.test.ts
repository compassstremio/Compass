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

const { STORAGE_KEY } = await import("../src/lib/settings/defaults");
const { loadStoredSettings } = await import("../src/lib/settings/load");
const { enforceAdultPolicy } = await import("../src/lib/settings/adult-policy");
const { adultContentHidden } = await import("../src/lib/addons-store/adult-filter");

test.beforeEach(() => values.clear());

test("adult content stays hidden even if a stored setting turned it off", () => {
  values.set(
    STORAGE_KEY,
    JSON.stringify({ hideContent: { adult: false, anime: false }, showAdultAddons: true }),
  );
  const s = loadStoredSettings();
  assert.equal(s.hideContent.adult, true);
  assert.equal(s.showAdultAddons, false);
  assert.equal(s.hideContent.anime, false);
});

test("the plugin and search filter ignores a stored opt-out", () => {
  values.set(STORAGE_KEY, JSON.stringify({ hideContent: { adult: false } }));
  assert.equal(adultContentHidden(), true);
});

test("a settings patch cannot switch the filter off", () => {
  const patch = enforceAdultPolicy({
    hideContent: { anime: true, adult: false, liveTv: false, manga: false, sports: false },
    showAdultAddons: true,
  });
  assert.equal(patch.hideContent?.adult, true);
  assert.equal(patch.hideContent?.anime, true);
  assert.equal(patch.showAdultAddons, false);
});

test("a patch that does not touch the filter is left alone", () => {
  const patch = { autoSkipIntro: true };
  assert.deepEqual(enforceAdultPolicy(patch), { autoSkipIntro: true });
});
