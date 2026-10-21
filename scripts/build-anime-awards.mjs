// Builds anime-awards.json, the id-keyed master the app fetches from <api>/anime-awards.json
// (see src/lib/anime-awards-source.ts for the shape it reads).
//
// Inputs are the award datasets and the title -> id map already committed under src/data.
// Titles with no id are left out: the app skips entries whose ids are null, and it still
// matches those by title from its bundled copy of the same datasets.
//
// usage: node scripts/build-anime-awards.mjs [output.json]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DATA = path.resolve("src/data");
const OUT = path.resolve(process.argv[2] ?? "dist-feed/anime-awards.json");

// Must stay in step with SOURCES / AOTY_KEYS in src/lib/anime-awards.ts.
const SOURCES = [
  { id: "crunchyroll", file: "crunchyroll-awards.json", aoty: ["anime_of_the_year"] },
  { id: "taaf", file: "taaf-awards.json", aoty: ["anime_of_the_year"] },
  { id: "jmaf", file: "japan-media-arts-awards.json", aoty: ["grand_prize"] },
  { id: "r_anime", file: "r-anime-awards.json", aoty: ["anime_of_the_year"] },
  { id: "animation_kobe", file: "animation-kobe-awards.json", aoty: ["best_film", "best_tv"] },
];

// Same normalisation as awardIdNorm() in src/lib/anime-awards.ts.
function norm(s) {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "kitsu:11999" -> { kitsu: 11999 }; the master's id fields are numbers.
function idsFrom(idString) {
  const m = /^(kitsu|anilist|mal|anidb):(\d+)$/.exec(idString ?? "");
  return m ? { [m[1]]: Number(m[2]) } : null;
}

const readJson = async (f) => JSON.parse(await readFile(path.join(DATA, f), "utf8"));

const idMap = await readJson("anime-award-ids.json");
const byId = new Map();
let skipped = 0;
let latest = "";

for (const src of SOURCES) {
  const data = await readJson(src.file);
  if (data.updatedAt > latest) latest = data.updatedAt;
  for (const [categoryKey, bucket] of Object.entries(data.categories ?? {})) {
    for (const w of bucket.winners) {
      const ids = idsFrom(idMap[norm(w.title)]?.id);
      if (!ids) {
        skipped += 1;
        continue;
      }
      const key = Object.entries(ids)[0].join(":");
      const entry = byId.get(key) ?? { title: w.title, ids, wins: [] };
      entry.wins.push({
        source: src.id,
        year: w.year,
        categoryKey,
        categoryName: bucket.name,
        isAOTY: src.aoty.includes(categoryKey),
      });
      byId.set(key, entry);
    }
  }
}

const entries = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
if (entries.length < 50) throw new Error(`only ${entries.length} entries; refusing to write`);

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: latest, entries }));
console.log(`anime-awards: ${entries.length} entries, ${skipped} wins without an id -> ${OUT}`);
