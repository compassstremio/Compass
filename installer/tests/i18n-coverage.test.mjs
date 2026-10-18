import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dictionaryFor } from "../ui/i18n.js";
import { INTRO, SECTIONS } from "../ui/terms-text.js";
import { CAPTIONS } from "../ui/lib/captions.js";

const UI = join(fileURLToPath(new URL(".", import.meta.url)), "..", "ui");
const SKIP = new Set(["locales", "vendor", "assets"]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : walk(path);
    return path.endsWith(".js") ? [path] : [];
  });
}

const LITERAL = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const literalKeys = new Map();
for (const file of walk(UI)) {
  for (const match of readFileSync(file, "utf8").matchAll(LITERAL)) {
    const key = match[2].replace(/\\(['"\\])/g, "$1");
    literalKeys.set(key, relative(UI, file));
  }
}
const constantKeys = [INTRO, ...SECTIONS.flatMap((s) => [s.heading, ...s.body]), ...CAPTIONS];

for (const code of ["ar", "pt", "pt-PT", "ru"]) {
  test(`${code} translates every literal t() key and every constant string`, () => {
    const dict = dictionaryFor(code);
    const missing = [...literalKeys].filter(([key]) => !(key in dict)).map(([key, file]) => `${file}: ${key}`);
    missing.push(...constantKeys.filter((key) => !(key in dict)).map((key) => `constant: ${key.slice(0, 60)}`));
    assert.deepEqual(missing, []);
  });
}
