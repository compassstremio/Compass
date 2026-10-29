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
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
  },
});
globalThis.fetch = (() => Promise.reject(new Error("offline fixture"))) as typeof fetch;

const discover = await import("../src/lib/discover/store");
const { rate } = await import("../src/lib/ratings/actions");
const { setRatingsLocalBulk } = await import("../src/lib/ratings/store");

const profile = {
  cast: [],
  directors: [],
  creators: [],
  genres: ["Thriller"],
  keywords: [],
  decade: "2010s",
};

function target(id: string) {
  return { itemKey: id, mediaType: "movie" as const, title: id };
}

async function rateQuietly(id: string, score: number) {
  await rate(target(id), score).catch(() => {});
}

function kinds(id: string) {
  return discover
    .getStore()
    .events.filter((e) => e.id === id)
    .map((e) => e.kind);
}

test.beforeEach(() => {
  discover.clearStore();
  values.clear();
});

test("a high rating records vote_up and raises the genre weight", async () => {
  discover.trackEvent("tt1", "open", profile);
  const before = discover.getStore().affinity.genres.Thriller ?? 0;
  await rateQuietly("tt1", 9);
  assert.deepEqual(kinds("tt1"), ["open", "vote_up"]);
  assert.ok((discover.getStore().affinity.genres.Thriller ?? 0) > before);
});

test("a low rating records vote_down and lowers the genre weight", async () => {
  discover.trackEvent("tt2", "open", profile);
  await rateQuietly("tt2", 2);
  assert.deepEqual(kinds("tt2"), ["open", "vote_down"]);
  const store = discover.getStore();
  assert.ok((store.affinity.genres.Thriller ?? 0) < 1);
});

test("a middling rating records nothing", async () => {
  discover.trackEvent("tt3", "open", profile);
  await rateQuietly("tt3", 6);
  assert.deepEqual(kinds("tt3"), ["open"]);
});

test("the 8 and 4 boundaries are inclusive", async () => {
  discover.trackEvent("tt4", "open", profile);
  discover.trackEvent("tt5", "open", profile);
  await rateQuietly("tt4", 8);
  await rateQuietly("tt5", 4);
  assert.deepEqual(kinds("tt4"), ["open", "vote_up"]);
  assert.deepEqual(kinds("tt5"), ["open", "vote_down"]);
});

test("a rating for a title with no known profile adds no event", async () => {
  await rateQuietly("tt6", 10);
  assert.deepEqual(kinds("tt6"), []);
});

test("a failed remote save still feeds taste, which is local", async () => {
  discover.trackEvent("tt7", "open", profile);
  await assert.rejects(rate(target("tt7"), 9));
  assert.deepEqual(kinds("tt7"), ["open", "vote_up"]);
});

test("bulk imports never add taste events", () => {
  discover.trackEvent("tt8", "open", profile);
  setRatingsLocalBulk([
    { itemKey: "tt8", mediaType: "movie", score: 10, title: "tt8", updatedAt: 1 },
  ]);
  assert.deepEqual(kinds("tt8"), ["open"]);
});
