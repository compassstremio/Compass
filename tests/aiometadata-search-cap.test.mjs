import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function provider() {
  const source = readFileSync(new URL("../src/lib/search-addons.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  // 150 is only here to exercise the caps; no single AIOMetadata catalog search returns more than 30.
  const metas = Array.from({ length: 150 }, (_, i) => ({
    id: `tt${i}`,
    name: `Result ${i}`,
    type: "movie",
  }));
  new Function("require", "exports", code)(
    (name) =>
      ({
        "./addons": { isCollectionCatalog: () => false },
        "./safe-fetch": { safeFetch: async () => ({ ok: true, json: async () => ({ metas }) }) },
      })[name] ?? {},
    exports,
  );
  return exports;
}
function addon(id) {
  return {
    transportUrl: "https://example.invalid/manifest.json",
    manifest: {
      id,
      name: "Test addon",
      catalogs: [{ id: "movies", type: "movie", extra: [{ name: "search" }] }],
    },
  };
}

for (const id of ["aio-metadata", "com.aio.metadata", "COM.AIO.METADATA"]) {
  test(`${id} retains up to 100 results through catalogs, groups, and both merges`, async () => {
    const p = provider();
    const result = await p.searchAddonCatalogs([addon(id)], "test");
    assert.equal(result.movies.length, 100);
    const merged = p.mergeMetas([], result.movies);
    assert.equal(p.mergeMetas(merged, result.movies).length, 100);
    assert.equal(new Set(merged.map((meta) => meta.id)).size, 100);
    const groups = await p.searchAddonGroups([addon(id)], "test");
    assert.equal(groups[0].metas.length, 100);
    assert.equal(p.mergeMetas([], result.movies, 5).length, 5);
  });
}

test("unrelated addons keep their existing catalog and group limits", async () => {
  const p = provider();
  for (const id of ["ordinary.addon", "aio-metadata-other"]) {
    assert.equal((await p.searchAddonCatalogs([addon(id)], "test")).movies.length, 20);
    assert.equal((await p.searchAddonGroups([addon(id)], "test"))[0].metas.length, 14);
  }
  assert.equal(
    p.mergeMetas(
      [],
      Array.from({ length: 150 }, (_, i) => ({ id: String(i) })),
    ).length,
    20,
  );
});
