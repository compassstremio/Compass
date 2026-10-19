import { safeFetch } from "@/lib/safe-fetch";
import { COMPASS_API_BASE } from "@/lib/config/endpoints";
import { getUiLanguage } from "@/lib/i18n";
import bundled from "./bundled-release-notes.json";

export type NoteMedia = {
  src: string;
  kind?: "image" | "sprite";
  alt?: string;
  height?: number;
};

export type NoteSection = { heading?: string; items: string[] };

export type NoteText = { title?: string; intro?: string; sections?: NoteSection[] };

export type ReleaseNote = NoteText & {
  media?: NoteMedia;
  /** Per-language text keyed by UI language code. Missing languages show the English text. */
  translations?: Record<string, NoteText>;
};

export function localizeNote(
  note: ReleaseNote | null,
  lang: string = getUiLanguage(),
): ReleaseNote | null {
  const text = note?.translations?.[lang];
  if (!note || !text) return note;
  const { translations: _all, ...base } = note;
  return {
    ...base,
    title: text.title ?? base.title,
    intro: text.intro ?? base.intro,
    sections: text.sections ?? base.sections,
  };
}

const URL = `${COMPASS_API_BASE}/release-notes.json`;
const bundledNotes: Record<string, ReleaseNote> = bundled.notes;

let cache: Record<string, ReleaseNote> | null = null;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    const res = await safeFetch(URL);
    const j = res.ok ? ((await res.json()) as { notes?: Record<string, ReleaseNote> }) : null;
    cache = j?.notes ?? {};
  } catch {
    cache = {};
  }
}

export async function releaseNote(version: string | null | undefined): Promise<ReleaseNote | null> {
  if (!version) return null;
  // Exact-version notes remain available offline and before feed publication.
  if (Object.hasOwn(bundledNotes, version)) return localizeNote(bundledNotes[version]);
  if (!cache) {
    if (!loading) loading = load();
    await loading;
  }
  return localizeNote(cache?.[version] ?? null);
}

export function hasRichNote(n: ReleaseNote | null | undefined): n is ReleaseNote {
  return !!n && !!(n.media || n.title || (n.sections && n.sections.length > 0));
}
