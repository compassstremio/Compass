import type { LyricLine } from "./lyrics";

/**
 * Lyric translation is index-aligned: providers receive only the non-empty lines and return one
 * string per input, so `LyricLine.at` is never touched and sync keeps working untouched.
 */
export type TranslatedLyricLine = LyricLine & { translation?: string };

export type TranslateProvider = {
  name: string;
  translate(texts: string[], target: string, signal?: AbortSignal): Promise<string[]>;
};

export type TranslateResult =
  | { ok: true; lines: string[]; provider: string }
  | { ok: false; reason: "no-provider" | "no-text" | "unsupported" | "failed" };

type FetchLike = typeof fetch;

const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
// A song is rarely longer; bounding it keeps one toggle from spending a whole free-tier quota.
const MAX_LINES = 120;

export async function translateLyricLines(lines: LyricLine[], target: string, providers: TranslateProvider[], signal?: AbortSignal): Promise<TranslateResult> {
  if (!LANGUAGE.test(target)) return { ok: false, reason: "unsupported" };
  if (!providers.length) return { ok: false, reason: "no-provider" };
  const indexes: number[] = [];
  lines.forEach((line, index) => { if (line.text.trim()) indexes.push(index); });
  if (!indexes.length) return { ok: false, reason: "no-text" };
  const texts = indexes.slice(0, MAX_LINES).map(index => lines[index].text.trim());
  for (const provider of providers) {
    if (signal?.aborted) break;
    try {
      const translated = await provider.translate(texts, target, signal);
      if (translated.length !== texts.length || translated.some(text => typeof text !== "string")) continue;
      const out = lines.map(() => "");
      translated.forEach((text, i) => { out[indexes[i]] = text.trim(); });
      return { ok: true, lines: out, provider: provider.name };
    } catch { /* try the next provider */ }
  }
  return { ok: false, reason: "failed" };
}

/** Pairs translations with the original lines; originals and timestamps are copied verbatim. */
export function attachTranslations(lines: LyricLine[], translated: string[] | null | undefined): TranslatedLyricLine[] {
  if (!translated || translated.length !== lines.length) return lines;
  return lines.map((line, i) => ({ ...line, translation: translated[i] || undefined }));
}

export function aiTranslateProvider({ key, model, isGroq, fetchImpl = fetch }: { key: string; model: string; isGroq: boolean; fetchImpl?: FetchLike }): TranslateProvider {
  return {
    name: isGroq ? "groq" : "openrouter",
    async translate(texts, target, signal) {
      const headers: Record<string, string> = { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" };
      if (!isGroq) headers["X-Title"] = "Compass";
      const response = await fetchImpl(isGroq ? GROQ_URL : OPENROUTER_URL, {
        method: "POST", headers, signal,
        body: JSON.stringify({
          model, temperature: 0.2, max_tokens: 4000,
          messages: [
            { role: "system", content: `Translate each song lyric line into the language with code "${target}". Reply with only a JSON array of strings, exactly the same length and order as the input. Keep line breaks out, keep names, and do not add explanations.` },
            { role: "user", content: JSON.stringify(texts) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`translation failed (${response.status})`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = (data.choices?.[0]?.message?.content ?? "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, "").trim();
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed) || parsed.length !== texts.length || parsed.some(item => typeof item !== "string")) throw new Error("unusable translation");
      return parsed as string[];
    },
  };
}

/** Keyless fallback. Free-tier quota is small, so quota replies are errors rather than "translations". */
export function myMemoryProvider({ fetchImpl = fetch }: { fetchImpl?: FetchLike } = {}): TranslateProvider {
  return {
    name: "mymemory",
    async translate(texts, target, signal) {
      const out: string[] = new Array(texts.length);
      let next = 0;
      // A few requests at a time: one-by-one made a whole song take about 20 seconds.
      const worker = async () => {
        while (next < texts.length) {
          const index = next++;
          const url = new URL(MYMEMORY_URL);
          url.searchParams.set("q", texts[index].slice(0, 450));
          url.searchParams.set("langpair", `Autodetect|${target}`);
          const response = await fetchImpl(url.toString(), { signal });
          if (!response.ok) throw new Error(`translation failed (${response.status})`);
          const data = await response.json() as { responseStatus?: number | string; responseData?: { translatedText?: string } };
          if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) throw new Error("translation unavailable");
          out[index] = data.responseData.translatedText;
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
      return out;
    },
  };
}

/** Session cache only: translations are cheap to redo on demand and must not weigh on idle cost. */
export function createLyricTranslationCache(max = 40) {
  const entries = new Map<string, string[]>();
  const key = (track: string, target: string) => `${track}\n${target.toLowerCase()}`;
  return {
    get: (track: string, target: string) => entries.get(key(track, target)),
    set(track: string, target: string, lines: string[]) {
      entries.set(key(track, target), lines);
      if (entries.size > max) entries.delete(entries.keys().next().value!);
    },
  };
}
