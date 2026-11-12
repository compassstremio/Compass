// @ts-expect-error Node test types are outside the browser tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are outside the browser tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are outside the browser tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("version metadata agrees across the app, and bundled beta notes stay clean", () => {
  const version: string = JSON.parse(read("package.json")).version;
  const escaped = version.replaceAll(".", "\\.");
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, version);
  assert.match(read("src-tauri/Cargo.toml"), new RegExp(`version = "${escaped}"`));
  assert.match(read("src-tauri/Cargo.lock"), new RegExp(`name = "compass"\r?\nversion = "${escaped}"`));
  const notes = JSON.parse(read("src/lib/updater/bundled-release-notes.json")).notes;
  assert.equal(notes["0.9.128"].title, "Compass Beta 0.9.128");
  assert.ok(notes["0.9.127"]);
  assert.doesNotMatch(JSON.stringify(notes), /compasssystem\.online/);
});
