import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const DIR = new URL("../installer/changelog/", import.meta.url);

test("every release ships one renderable changelog file", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
  assert.ok(files.length > 0, "installer/changelog holds no release notes");
  const seen = new Set();
  for (const name of files) {
    assert.match(name, /^\d+\.\d+\.\d+-changelog\.json$/, `bad changelog file name: ${name}`);
    const version = name.replace(/-changelog\.json$/, "");
    assert.ok(!seen.has(version), `duplicate changelog for ${version}`);
    seen.add(version);
    const doc = JSON.parse(readFileSync(new URL(name, DIR), "utf8"));
    assert.ok(
      doc.channel === undefined || doc.channel === "stable" || doc.channel === "beta",
      `bad channel in ${name}`,
    );
    if (doc.pub_date !== undefined) {
      assert.match(String(doc.pub_date), /^\d{4}-\d{2}-\d{2}/, `bad pub_date in ${name}`);
    }
    const note = doc.notes && doc.notes[version];
    assert.ok(note, `${name} must hold notes["${version}"]`);
    assert.ok(typeof note.title === "string" && note.title.trim(), `${name} has no title`);
    assert.ok(typeof note.intro === "string" && note.intro.trim(), `${name} has no intro`);
    assert.ok(Array.isArray(note.sections) && note.sections.length > 0, `${name} has no sections`);
    for (const section of note.sections) {
      assert.ok(
        typeof section.heading === "string" && section.heading.trim(),
        `${name} has a section without a heading`,
      );
      assert.ok(
        Array.isArray(section.items) && section.items.length > 0,
        `${name} section "${section.heading}" has no items`,
      );
    }
  }
});
