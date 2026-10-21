import assert from "node:assert/strict";
import test from "node:test";
import bundled from "../src/lib/updater/bundled-release-notes.json" with { type: "json" };
import { localizeNote, releaseNote, type ReleaseNote } from "../src/lib/updater/release-notes.ts";

const sample: ReleaseNote = {
  title: "English title",
  intro: "English intro",
  sections: [{ heading: "English", items: ["one"] }],
  translations: { ar: { title: "عنوان", sections: [{ heading: "عربي", items: ["واحد"] }] } },
};

test("a translated note replaces its text and keeps untranslated fields", () => {
  const out = localizeNote(sample, "ar");
  assert.equal(out?.title, "عنوان");
  assert.equal(out?.intro, "English intro");
  assert.equal(out?.sections?.[0].items[0], "واحد");
  assert.equal(out?.translations, undefined);
});

test("languages without a translation show the English note", () => {
  assert.equal(localizeNote(sample, "fr"), sample);
  assert.equal(localizeNote(null, "ar"), null);
});

test("0.9.136 ships English and Arabic text with matching section structure", async () => {
  const note = (bundled.notes as Record<string, ReleaseNote>)["0.9.136"];
  assert.ok(note?.sections?.length);
  const ar = note.translations?.ar;
  assert.ok(ar?.title && ar.intro && ar.sections);
  assert.equal(ar.sections.length, note.sections.length);
  ar.sections.forEach((section, i) => {
    assert.equal(section.items.length, note.sections![i].items.length, `section ${i}`);
  });
  const loaded = await releaseNote("0.9.136");
  assert.equal(loaded?.title, "Compass Beta 0.9.136");
});
