import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadParser() {
  const source = readFileSync(new URL("../src/lib/anilist/mutations.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("mutations.ts", source, ts.ScriptTarget.Latest, true);
  const parser = tree.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "parseAnilistListNames",
  );
  assert.ok(parser, "parseAnilistListNames must exist");
  const output = ts.transpileModule(parser.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { parseAnilistListNames?: (value: unknown) => string[] } = {};
  new Function("exports", output)(exports);
  return exports.parseAnilistListNames!;
}

const parse = loadParser();

test("an entry's list array is read as-is", () => {
  assert.deepEqual(parse(["Favorites", "Rewatch"]), ["Favorites", "Rewatch"]);
});

test("the viewer's JSON string is decoded", () => {
  assert.deepEqual(parse('["Favorites","Rewatch"]'), ["Favorites", "Rewatch"]);
});

test("empty and malformed values never invent a list", () => {
  assert.deepEqual(parse(""), []);
  assert.deepEqual(parse("   "), []);
  assert.deepEqual(parse("[not json"), []);
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse({ 0: "Favorites" }), []);
  assert.deepEqual(parse(JSON.stringify([1, "Favorites", "", "  "])), ["Favorites"]);
});
