import assert from "node:assert/strict";
import test from "node:test";
import { mb, compareVersions, samePath, compassDir, clampPct, isolate } from "../ui/lib/format.js";
import { installAction } from "../ui/lib/install-action.js";
import { pickLocale } from "../ui/lib/locale-detect.js";
import { CAPTIONS, captionIndex } from "../ui/lib/captions.js";
import { formatDate, parseNotes } from "../ui/lib/notes.js";

test("mb formats megabytes and gigabytes", () => {
  assert.equal(mb(0), "0 MB");
  assert.equal(mb(113868800), "109 MB");
  assert.equal(mb(1610612736), "1.50 GB");
});

test("compareVersions orders dotted versions", () => {
  assert.equal(compareVersions("0.9.134", "0.9.133"), 1);
  assert.equal(compareVersions("0.9.9", "0.9.10"), -1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("samePath ignores case and trailing slashes, rejects empty", () => {
  assert.equal(samePath("C:\\Apps\\Compass\\", "c:\\apps\\compass"), true);
  assert.equal(samePath("", ""), false);
  assert.equal(samePath("C:\\A", "C:\\B"), false);
});

test("compassDir appends a Compass folder unless already chosen", () => {
  assert.equal(compassDir("D:\\Apps"), "D:\\Apps\\Compass");
  assert.equal(compassDir("D:\\Apps\\Compass\\"), "D:\\Apps\\Compass");
  assert.equal(compassDir("D:\\apps\\compass"), "D:\\apps\\compass");
});

test("isolate wraps text in left-to-right isolate marks", () => {
  assert.equal(isolate("558 MB"), "⁦558 MB⁩");
  assert.equal(isolate(134), "⁦134⁩");
});

test("clampPct keeps progress inside 0..100", () => {
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct(42.6), 43);
  assert.equal(clampPct(250), 100);
  assert.equal(clampPct(undefined), 0);
});

test("installAction picks install, update, downgrade or repair", () => {
  const prior = { path: "C:\\Compass", version: "0.9.100" };
  assert.deepEqual(installAction(null, "0.9.134", "C:\\Compass"), { mode: "install", kind: "install", from: "" });
  assert.deepEqual(installAction(prior, "0.9.134", "D:\\Elsewhere"), { mode: "install", kind: "install", from: "" });
  assert.deepEqual(installAction(prior, "0.9.134", "C:\\Compass"), { mode: "install", kind: "update", from: "0.9.100" });
  assert.deepEqual(installAction(prior, "0.9.50", "C:\\Compass"), { mode: "install", kind: "downgrade", from: "0.9.100" });
  assert.deepEqual(installAction(prior, "0.9.100", "c:\\compass\\"), { mode: "repair", kind: "repair", from: "0.9.100" });
});

test("pickLocale maps system languages to supported locales", () => {
  assert.equal(pickLocale(["ar-SA"]), "ar");
  assert.equal(pickLocale(["pt-BR"]), "pt");
  assert.equal(pickLocale(["pt-PT"]), "pt-PT");
  assert.equal(pickLocale(["fr-FR", "ru-RU"]), "ru");
  assert.equal(pickLocale(["EN-us"]), "en");
  assert.equal(pickLocale(["de"]), "en");
  assert.equal(pickLocale([]), "en");
  assert.equal(pickLocale(undefined), "en");
});

test("captionIndex cycles through the captions", () => {
  assert.equal(CAPTIONS.length, 4);
  assert.equal(captionIndex(0, 1000), 0);
  assert.equal(captionIndex(999, 1000), 0);
  assert.equal(captionIndex(1000, 1000), 1);
  assert.equal(captionIndex(4000, 1000), 0);
  assert.equal(captionIndex(-50, 1000), 0);
});

test("formatDate renders d Mon yyyy and tolerates junk", () => {
  assert.equal(formatDate("2026-10-18T10:00:00Z").endsWith("2026"), true);
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("not a date"), "");
});

test("parseNotes splits headings, bullets and prose and drops the version line", () => {
  const notes = ["0.9.134", "Fixes", "- Faster start", "* Fewer crashes", "This release rebuilds the updater so it is more reliable."].join("\n");
  assert.deepEqual(parseNotes(notes, "0.9.134"), [
    { kind: "head", text: "Fixes" },
    { kind: "item", text: "Faster start" },
    { kind: "item", text: "Fewer crashes" },
    { kind: "prose", text: "This release rebuilds the updater so it is more reliable." },
  ]);
  assert.deepEqual(parseNotes("", "1.0.0"), []);
});
