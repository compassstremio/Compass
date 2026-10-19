import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = (path, mocks = {}, storage) => {
  const code = ts.transpileModule(read(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "localStorage", code)(
    (id) => mocks[id] ?? {},
    exports,
    storage,
  );
  return exports;
};

test("temporary browsing entries never enter Watchlist with bookmark filtering disabled", () => {
  const tab = load("src/views/library/watchlist-tab.tsx");
  const items = [
    { _id: "saved", removed: false, temp: false },
    { _id: "browsed", removed: false, temp: true },
  ];
  assert.deepEqual(
    tab.filterLibrary(items, false, "watchlist").map((x) => x._id),
    ["saved"],
  );
  assert.deepEqual(
    tab.filterLibrary(items, false, "library").map((x) => x._id),
    ["saved", "browsed"],
  );
});

for (const remote of [
  null,
  { removed: true, temp: false, _mtime: "2026-01-01" },
  { removed: false, temp: true, _mtime: "2026-01-01" },
  { removed: false, temp: false, _mtime: "2026-01-01" },
]) {
  test(`offline progress respects latest bookmark membership ${JSON.stringify(remote)}`, async () => {
    const writes = [];
    const data = new Map();
    let offline = true;
    const queue = load(
      "src/lib/stremio-write-queue.ts",
      {
        "@/lib/stremio": {
          libraryGetOneStrict: async () => remote,
          libraryPut: async (auth, item) => {
            if (offline) throw Error("offline");
            writes.push(item);
          },
        },
      },
      { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
    );
    await queue.cloudLibraryPut("fixture", {
      _id: "tt1",
      removed: false,
      temp: false,
      _mtime: "2026-01-02",
      state: { timeOffset: 60000 },
    });
    offline = false;
    await queue.flushWriteQueue();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].removed, remote?.removed ?? true);
    assert.equal(writes[0].temp, !remote || remote.removed || remote.temp);
    assert.equal(writes[0].state.timeOffset, 60000);
  });
}

for (const membership of [
  null,
  { removed: true, temp: false },
  { removed: false, temp: true },
  { removed: false, temp: false },
]) {
  test(`active progress respects fresh bookmark membership ${JSON.stringify(membership)}`, async () => {
    const writes = [];
    const code = ts.transpileModule(
      read("src/views/player/hooks/use-stremio-sync.ts").replaceAll(
        "import.meta.env",
        "({DEV:false})",
      ) + "\nexport {writeLibraryItem};",
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const mocks = {
      "@/lib/stremio": { libraryGetOneStrict: async () => membership },
      "@/lib/stremio-item-lock": { withItemLock: async (id, fn) => fn() },
      "@/lib/stremio-write-queue": {
        cloudLibraryPut: async (auth, item) => {
          writes.push(item);
          return true;
        },
      },
    };
    const exports = {};
    new Function("require", "exports", code)((id) => mocks[id] ?? {}, exports);
    await exports.writeLibraryItem(
      "fixture",
      { meta: { id: "tt1", name: "Fixture", type: "movie" } },
      { durationSec: 3600, status: "playing" },
      { _id: "tt1", removed: false, temp: false, state: {} },
      "tt1",
      300,
      false,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].removed, !membership || membership.removed || membership.temp);
    assert.equal(writes[0].temp, !membership || membership.removed || membership.temp);
    assert.equal(writes[0].state.timeOffset, 300000);
  });
}

test("an unreachable membership read still reaches the write so the queue can replay it", async () => {
  const writes = [];
  const code = ts.transpileModule(
    read("src/views/player/hooks/use-stremio-sync.ts").replaceAll(
      "import.meta.env",
      "({DEV:false})",
    ) + "\nexport {writeLibraryItem};",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const mocks = {
    "@/lib/stremio": {
      libraryGetOneStrict: async () => {
        throw Error("offline");
      },
    },
    "@/lib/stremio-item-lock": { withItemLock: async (id, fn) => fn() },
    "@/lib/stremio-write-queue": {
      cloudLibraryPut: async (auth, item) => {
        writes.push(item);
        return true;
      },
    },
  };
  const exports = {};
  new Function("require", "exports", code)((id) => mocks[id] ?? {}, exports);
  await exports.writeLibraryItem(
    "fixture",
    { meta: { id: "tt1", name: "Fixture", type: "movie" } },
    { durationSec: 3600, status: "playing" },
    { _id: "tt1", removed: false, temp: false, state: {} },
    "tt1",
    300,
    false,
  );
  // Dropping the write here would lose the progress outright, since the queue is the only thing
  // that replays it once the server answers again.
  assert.equal(writes.length, 1);
  assert.equal(writes[0].removed, false);
  assert.equal(writes[0].temp, false);
  assert.equal(writes[0].state.timeOffset, 300000);
});
