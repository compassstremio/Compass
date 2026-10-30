import type { JSX } from "react";
import { LANGUAGES, useT } from "@/lib/i18n";
import type { useLyricTranslation } from "@/lib/music/use-lyric-translation";
import "./lyric-translate-control.css";

type Translation = ReturnType<typeof useLyricTranslation>;

const ERRORS = {
  "no-provider": "Lyric translation is unavailable",
  "no-text": "Lyric translation is unavailable",
  unsupported: "That language is not supported for lyric translation",
  failed: "Could not translate these lyrics. Try again later.",
} as const;

export function LyricTranslateControl({ translation }: { translation: Translation }): JSX.Element {
  const t = useT();
  const { enabled, target, state, error, setEnabled, setTarget } = translation;
  return (
    <div className="lyric-translate">
      <button type="button" aria-pressed={enabled} onClick={() => setEnabled(!enabled)} title={t("Translate lyrics")}>
        {t("Translate lyrics")}
      </button>
      {enabled ? (
        <select value={target} onChange={event => setTarget(event.target.value)} aria-label={t("Translate lyrics to")}>
          {LANGUAGES.some(language => language.code === target) ? null : <option value={target}>{target}</option>}
          {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.nativeLabel}</option>)}
        </select>
      ) : null}
      {state === "loading" ? <span role="status">{t("Translating lyrics")}</span> : null}
      {state === "error" && error ? <span role="status" className="lyric-translate-error">{t(ERRORS[error])}</span> : null}
    </div>
  );
}
