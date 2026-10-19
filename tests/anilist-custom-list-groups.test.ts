import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Group = {
  status: string | null;
  name?: string | null;
  isCustomList?: boolean;
  entries: Array<{ media: { id: number } }>;
};

function loadBuildGroups() {
  const source = readFileSync(new URL("../src/lib/anilist/lists.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("lists.ts", source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "buildGroups",
  );
  assert.ok(fn, "buildGroups must exist");
  const output = ts.transpileModule(fn.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { buildGroups?: (lists: unknown[]) => Group[] } = {};
  new Function("exports", `${output}\nexports.buildGroups = buildGroups;`)(exports);
  return exports.buildGroups!;
}

const build = loadBuildGroups();
const entry = (id: number) => ({ media: { id } });

test("split completed sections merge into one deduplicated status group", () => {
  const groups = build([
    { status: "COMPLETED", name: "Completed", isCustomList: false, entries: [entry(1)] },
    { status: "COMPLETED", name: "Completed", isCustomList: false, entries: [entry(1), entry(2)] },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, "COMPLETED");
  assert.deepEqual(
    groups[0].entries.map((e) => e.media.id),
    [1, 2],
  );
});

test("custom lists are kept beside the status groups with their own entries", () => {
  const groups = build([
    { status: "CURRENT", name: "Watching", isCustomList: false, entries: [entry(1)] },
    { status: null, name: "Favorites", isCustomList: true, entries: [entry(1), entry(2)] },
  ]);
  assert.equal(groups.length, 2);
  const custom = groups[1];
  assert.equal(custom.status, null);
  assert.equal(custom.name, "Favorites");
  assert.equal(custom.isCustomList, true);
  // The same title may sit in the status list and the custom list; both sections show it.
  assert.deepEqual(
    custom.entries.map((e) => e.media.id),
    [1, 2],
  );
});

test("nameless and empty custom lists are dropped", () => {
  const groups = build([
    { status: null, name: "   ", isCustomList: true, entries: [entry(1)] },
    { status: null, name: "Empty", isCustomList: true, entries: [] },
  ]);
  assert.deepEqual(groups, []);
});
