import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { aiIsGroq, aiKey, DEFAULT_AI_MODEL, migrateModelId } from "@/lib/ai-models";
import { getUiLanguage } from "@/lib/i18n";
import { useSettings } from "@/lib/settings";
import { readMusicPreference, writeMusicPreference } from "./preferences";
import type { LyricLine } from "./lyrics";
import {
  aiTranslateProvider,
  attachTranslations,
  createLyricTranslationCache,
  myMemoryProvider,
  translateLyricLines,
  type TranslatedLyricLine,
  type TranslateProvider,
} from "./lyric-translation";

const PREF_KEY = "compass.music.lyric-translation.v1";
type Pref = { enabled: boolean; target: string };
export type LyricTranslationState = "off" | "loading" | "ready" | "error";
export type LyricTranslationError = "no-provider" | "no-text" | "unsupported" | "failed";

const cache = createLyricTranslationCache();
const listeners = new Set<() => void>();
let snapshot: Pref | null = null;

function read(): Pref {
  if (snapshot) return snapshot;
  let parsed: Partial<Pref> = {};
  try { parsed = JSON.parse(readMusicPreference(PREF_KEY) ?? "{}") as Partial<Pref>; } catch { /* default off */ }
  // Off until the listener asks for it: nothing is sent to a translation service on its own.
  snapshot = { enabled: parsed.enabled === true, target: typeof parsed.target === "string" && parsed.target ? parsed.target : getUiLanguage() };
  return snapshot;
}

function write(next: Pref): void {
  snapshot = next;
  writeMusicPreference(PREF_KEY, JSON.stringify(next));
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Opt-in lyric translation. `lines` is the untouched original; `shown` adds `translation` per line. */
export function useLyricTranslation(lines: LyricLine[] | null, trackKey: string) {
  const pref = useSyncExternalStore(subscribe, read, read);
  const { settings } = useSettings();
  const [translated, setTranslated] = useState<string[] | null>(null);
  const [state, setState] = useState<LyricTranslationState>("off");
  const [error, setError] = useState<LyricTranslationError | null>(null);

  const key = aiKey(settings), isGroq = aiIsGroq(settings), model = migrateModelId((settings.aiSearchModel ?? "").trim()) || DEFAULT_AI_MODEL;
  const providers = useMemo<TranslateProvider[]>(() => [
    ...(key.trim() ? [aiTranslateProvider({ key, model, isGroq })] : []),
    myMemoryProvider(),
  ], [key, model, isGroq]);

  useEffect(() => {
    setTranslated(null); setError(null);
    if (!pref.enabled || !lines?.length || !trackKey) { setState("off"); return; }
    const held = cache.get(trackKey, pref.target);
    if (held) { setTranslated(held); setState("ready"); return; }
    const request = new AbortController();
    setState("loading");
    void translateLyricLines(lines, pref.target, providers, request.signal).then(result => {
      if (request.signal.aborted) return;
      if (result.ok) { cache.set(trackKey, pref.target, result.lines); setTranslated(result.lines); setState("ready"); }
      else { setError(result.reason); setState("error"); }
    });
    return () => request.abort();
  }, [pref.enabled, pref.target, trackKey, lines, providers]);

  const shown: TranslatedLyricLine[] = useMemo(() => attachTranslations(lines ?? [], translated), [lines, translated]);
  const setEnabled = useCallback((enabled: boolean) => write({ ...read(), enabled }), []);
  const setTarget = useCallback((target: string) => write({ ...read(), target }), []);
  return { enabled: pref.enabled, target: pref.target, state, error, shown, setEnabled, setTarget };
}
