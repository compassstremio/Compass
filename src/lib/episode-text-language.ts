// TMDB/TVDB return original-language text (Japanese for most anime) when the requested
// translation is missing, so only accept text written in the target language's script.
const SCRIPT_TEST: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF\u0750-\u077F]/,
  fa: /[\u0600-\u06FF\u0750-\u077F]/,
  ur: /[\u0600-\u06FF\u0750-\u077F]/,
  ru: /[\u0400-\u04FF]/,
  uk: /[\u0400-\u04FF]/,
  bg: /[\u0400-\u04FF]/,
  sr: /[\u0400-\u04FF]/,
  mk: /[\u0400-\u04FF]/,
  be: /[\u0400-\u04FF]/,
  el: /[\u0370-\u03FF]/,
  hi: /[\u0900-\u097F]/,
  mr: /[\u0900-\u097F]/,
  ne: /[\u0900-\u097F]/,
  th: /[\u0E00-\u0E7F]/,
  he: /[\u0590-\u05FF]/,
  yi: /[\u0590-\u05FF]/,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  zh: /[\u3400-\u4DBF\u4E00-\u9FFF]/,
  ja: /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/,
};

const FOREIGN_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u0400-\u04FF\u0370-\u03FF\u0900-\u097F\u0E00-\u0E7F\u0590-\u05FF\uAC00-\uD7AF\u1100-\u11FF\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF]/;

export function isTextInLanguage(text: string | null | undefined, lang: string | null | undefined): boolean {
  if (!text) return false;
  const base = lang?.trim().split("-")[0]?.toLowerCase() ?? "";
  if (!base || base === "en") return true;
  const range = SCRIPT_TEST[base];
  if (range) return range.test(text);
  return !FOREIGN_SCRIPT.test(text);
}

export function isUsableLocalizedText(text: string | null | undefined, lang: string | null | undefined): boolean {
  if (!text) return false;
  if (isTextInLanguage(text, lang)) return true;
  const base = lang?.trim().split("-")[0]?.toLowerCase() ?? "";
  return base !== "en" && !FOREIGN_SCRIPT.test(text);
}

const ISO3: Record<string, string> = {
  eng: "en", spa: "es", fra: "fr", deu: "de", ita: "it", jpn: "ja", kor: "ko",
  rus: "ru", por: "pt", zho: "zh", ara: "ar", nld: "nl", pol: "pl", tur: "tr",
  swe: "sv", dan: "da", fin: "fi", nor: "no", ces: "cs", hun: "hu", ell: "el",
  heb: "he", tha: "th", vie: "vi", ind: "id", ukr: "uk", ron: "ro", hin: "hi",
};

export function episodeLanguageBase(language?: string | null): string {
  const base = language?.trim().toLowerCase().split("-")[0] || "en";
  return ISO3[base] ?? base;
}

// A localized endpoint may return English. Compare fields independently using
// responses already loaded by the caller; without evidence, retain uncertainty.
export function episodeTextLanguage(
  text: string | null | undefined,
  requested?: string | null,
  english?: string | null,
  availableLanguages?: string[],
): string {
  if (!text?.trim()) return "und";
  const lang = episodeLanguageBase(requested);
  if (english?.trim() && text.trim() === english.trim() && !FOREIGN_SCRIPT.test(english)) return "en";
  if (Array.isArray(availableLanguages) && !availableLanguages.some((available) => episodeLanguageBase(available) === lang)) return "und";
  if (lang === "en") return FOREIGN_SCRIPT.test(text) ? "und" : "en";
  if (!isTextInLanguage(text, lang)) return "und";
  if (Array.isArray(availableLanguages) && availableLanguages.some((available) => episodeLanguageBase(available) === lang)) return lang;
  // A different Latin original is not evidence of a requested translation.
  if (SCRIPT_TEST[lang]) return lang;
  return "und";
}

export type EpisodeTextCandidate = { text?: string | null; language?: string; score?: number };
export type EpisodeTextInput = string | null | undefined | EpisodeTextCandidate;

export function episodeTextRank(text: string, language: string | undefined, requested?: string | null): 0 | 1 | 2 | 3 {
  const lang = episodeLanguageBase(requested);
  if (!text.trim()) return 0;
  if (lang === "en" && FOREIGN_SCRIPT.test(text)) return 0;
  if (!isUsableLocalizedText(text, lang)) return 0;
  if (language && language !== "und") {
    if (episodeLanguageBase(language) === lang) return 3;
    return 1;
  }
  // Distinct scripts can establish a match; Latin scripts cannot distinguish
  // Turkish/French/etc. from English without provider translation evidence.
  if (lang !== "en" && SCRIPT_TEST[lang]?.test(text)) return 3;
  return 2;
}


export function isForeignScriptTitle(text: string | null | undefined): boolean {
  return !!text && FOREIGN_SCRIPT.test(text);
}
