import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

for (const base of [
  null,
  { removed: true, temp: false },
  { removed: false, temp: true },
  { removed: false, temp: false },
]) {
  test(`watched writes preserve explicit bookmark membership ${JSON.stringify(base)}`, async () => {
    const writes = [];
    const api = {};
    const mocks = {
      "@/lib/stremio": { libraryGetOneStrict: async () => base },
      "@/lib/stremio-write-queue": {
        cloudLibraryPut: async (_auth, item) => {
          writes.push(item);
          return true;
        },
      },
      "@/lib/stremio-item-lock": { withItemLock: (_id, work) => work() },
    };
    const code = ts.transpileModule(
      readFileSync(new URL("../src/lib/stremio-watched-sync.ts", import.meta.url), "utf8"),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText;
    new Function("require", "exports", code)((name) => mocks[name] || {}, api);
    await api.markMovieWatchedStremio(
      "test",
      { id: "tt1", name: "Test", type: "movie" },
      "tt1",
      true,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].temp, !base || base.removed || base.temp);
    assert.equal(writes[0].removed, base?.removed || false);
  });
}
