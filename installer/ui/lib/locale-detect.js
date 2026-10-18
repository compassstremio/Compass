const SUPPORTED = ["en", "pt", "pt-PT", "ru", "ar"];

export function pickLocale(languages) {
  for (const raw of languages || []) {
    const tag = String(raw || "").trim().toLowerCase();
    if (!tag) continue;
    if (tag === "pt-pt") return "pt-PT";
    const base = tag.split("-")[0];
    const hit = SUPPORTED.find((code) => code.toLowerCase() === base);
    if (hit) return hit;
  }
  return "en";
}
