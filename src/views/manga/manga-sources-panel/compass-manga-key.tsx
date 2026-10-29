import { useEffect, useState } from "react";
import { Check, ExternalLink, KeyRound, Trash2 } from "lucide-react";
import {
  COMPASS_MANGA_ACCOUNT_URL,
  hostedSourcesForLanguage,
  mangaKeyState,
  removeMangaKey,
  saveMangaKey,
  savedKeyPrefix,
  subscribeHostedSources,
  type SaveKeyResult,
} from "@/lib/manga/sources/compass-hosted";
import { openUrl } from "@/lib/window";
import { useT } from "@/lib/i18n";
import { CARD, INPUT, PRIMARY_BTN } from "./shared";

const SECONDARY_BTN =
  "flex h-12 items-center justify-center gap-2 rounded-xl bg-canvas px-4 text-[15px] font-medium text-ink ring-1 ring-edge-soft transition-all hover:bg-raised active:scale-[0.98]";

const FAILURE: Record<Exclude<SaveKeyResult, "saved">, string> = {
  malformed: "This doesn't look like a Compass Manga key.",
  rejected: "That key wasn't accepted. Copy it again from your account page.",
  unreachable: "Couldn't reach Compass Manga. Check your connection and try again.",
};

// Compass Manga: sources in the reader's language, read with a key from their account page.
// Rendered only when the server offers a source in the interface language.
export function CompassMangaKey() {
  const t = useT();
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeHostedSources(() => setTick((n) => n + 1)), []);

  const sources = hostedSourcesForLanguage();
  if (sources.length === 0) return null;
  const state = mangaKeyState();
  const names = sources.map((s) => s.name).join(" · ");
  const getKey = () => openUrl(COMPASS_MANGA_ACCOUNT_URL);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await saveMangaKey(draft);
    setBusy(false);
    if (result === "saved") setDraft("");
    else setError(t(FAILURE[result]));
  };

  return (
    <div className={`${CARD} flex flex-col gap-4 px-5 py-5`}>
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-canvas ring-1 ring-edge-soft">
          <KeyRound size={20} className="text-ink-muted" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[16px] font-semibold text-ink">Compass Manga</span>
          <span className="truncate text-[13.5px] text-ink-muted">{names}</span>
        </span>
      </div>

      {state === "saved" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex flex-1 items-center gap-2 text-[14.5px] text-ink">
            <Check size={17} className="text-success" />
            {t("Key saved")}
            <code dir="ltr" className="text-[13px] text-ink-subtle">
              {savedKeyPrefix()}…
            </code>
          </span>
          <button type="button" onClick={getKey} className={SECONDARY_BTN}>
            <ExternalLink size={16} /> {t("Account page")}
          </button>
          <button type="button" onClick={removeMangaKey} className={SECONDARY_BTN} aria-label={t("Remove key")}>
            <Trash2 size={16} /> {t("Remove key")}
          </button>
        </div>
      ) : (
        <>
          <p className="text-[14.5px] leading-relaxed text-ink-muted">
            {state === "rejected"
              ? t("This key isn't valid anymore. Get a new one from your account page.")
              : t("Read {sources} here with your Compass Manga key.", { sources: names })}
          </p>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && !busy) void save();
            }}
            placeholder="cmp_…"
            dir="ltr"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.trim()}
              className={`${PRIMARY_BTN} flex-1 px-5`}
            >
              {busy ? t("Checking…") : t("Save key")}
            </button>
            <button type="button" onClick={getKey} className={SECONDARY_BTN}>
              <ExternalLink size={16} /> {t("Get a key")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
