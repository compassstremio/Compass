import { Check, ChevronDown, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import anilistLogo from "@/assets/anilist.png";
import { AnchoredMenu } from "@/components/anchored-menu";
import { HoverTooltip } from "@/components/hover-tooltip";
import { deleteListEntry, fetchListEntry, saveListEntry } from "@/lib/anilist/mutations";
import { useAnilist } from "@/lib/anilist/provider";
import { resolveAnilistMediaId } from "@/lib/anilist/sync";
import type { MediaListStatus } from "@/lib/anilist/types";
import { useT } from "@/lib/i18n";

const STATUS_LABELS: Record<MediaListStatus, string> = {
  CURRENT: "Watching",
  PLANNING: "Plan to Watch",
  COMPLETED: "Completed",
  REPEATING: "Rewatching",
  PAUSED: "On Hold",
  DROPPED: "Dropped",
};

const STATUS_ORDER: MediaListStatus[] = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "REPEATING",
  "PAUSED",
  "DROPPED",
];

export function AddToAnilistButton({ compassId, title }: { compassId: string; title: string }) {
  const t = useT();
  const { isConnected } = useAnilist();
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [entryId, setEntryId] = useState<number | null>(null);
  const [status, setStatus] = useState<MediaListStatus | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [entryLists, setEntryLists] = useState<string[]>([]);
  const [availableLists, setAvailableLists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setAttempt(0);
  }, [compassId]);

  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    let timer: number | undefined;
    (async () => {
      const id = await resolveAnilistMediaId(compassId).catch(() => null);
      if (cancelled) return;
      if (id == null) {
        if (attempt < 2) timer = window.setTimeout(() => setAttempt((a) => a + 1), 15000);
        return;
      }
      setMediaId(id);
      const info = await fetchListEntry(id).catch(() => null);
      if (cancelled) return;
      setEntryId(info?.entry?.id ?? null);
      setStatus(info?.entry?.status ?? null);
      setPrivacy(info?.entry?.private ?? false);
      setEntryLists(info?.entry?.customLists ?? []);
      setAvailableLists(info?.customLists ?? []);
    })();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [compassId, isConnected, attempt]);

  if (!isConnected || mediaId == null) return null;

  const setTo = async (next: MediaListStatus) => {
    setBusy(true);
    const prev = status;
    setStatus(next);
    setMenuOpen(false);
    try {
      const saved = await saveListEntry({ mediaId, status: next });
      setEntryId(saved.id);
      setStatus(saved.status);
    } catch {
      setStatus(prev);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (entryId == null) return;
    setBusy(true);
    const prevStatus = status;
    const prevEntry = entryId;
    const prevPrivacy = privacy;
    const prevLists = entryLists;
    setStatus(null);
    setEntryId(null);
    setPrivacy(false);
    setEntryLists([]);
    setMenuOpen(false);
    try {
      await deleteListEntry(prevEntry);
    } catch {
      setStatus(prevStatus);
      setEntryId(prevEntry);
      setPrivacy(prevPrivacy);
      setEntryLists(prevLists);
    } finally {
      setBusy(false);
    }
  };

  /** The flags are saved on their own so a status change never clears them. */
  const togglePrivate = async () => {
    const next = !privacy;
    setBusy(true);
    setPrivacy(next);
    try {
      await saveListEntry({ mediaId, private: next });
    } catch {
      setPrivacy(!next);
    } finally {
      setBusy(false);
    }
  };

  const toggleList = async (name: string) => {
    const next = entryLists.includes(name)
      ? entryLists.filter((list) => list !== name)
      : [...entryLists, name];
    const prev = entryLists;
    setBusy(true);
    setEntryLists(next);
    try {
      await saveListEntry({ mediaId, customLists: next });
    } catch {
      setEntryLists(prev);
    } finally {
      setBusy(false);
    }
  };

  if (status == null) {
    return (
      <HoverTooltip label={t("Add {title} to AniList", { title })} align="center" className="shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={() => void setTo("PLANNING")}
          className="flex h-12 items-center gap-2.5 rounded-full bg-canvas/80 px-6 text-[15px] font-medium text-ink transition-[transform,background-color] duration-200 hover:bg-canvas/95 active:scale-[0.98] disabled:opacity-60"
        >
          <img src={anilistLogo} alt="" className="h-[18px] w-[18px] rounded-[3px] object-contain" />
          <Plus size={16} strokeWidth={2.2} className="-ms-1" />
          {t("Add to AniList")}
        </button>
      </HoverTooltip>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={busy}
        onClick={() => setMenuOpen((v) => !v)}
        className="flex h-12 items-center gap-2.5 rounded-full border border-ink bg-ink/10 px-6 text-[15px] font-medium text-ink transition-[transform,background-color,border-color] duration-200 hover:bg-ink/20 active:scale-[0.98] disabled:opacity-60"
      >
        <img src={anilistLogo} alt="" className="h-[18px] w-[18px] rounded-[3px] object-contain" />
        {t(STATUS_LABELS[status])}
        <ChevronDown
          size={16}
          className={`text-ink-muted transition-transform ${menuOpen ? "rotate-180" : ""}`}
        />
      </button>
      <AnchoredMenu anchorRef={btnRef} open={menuOpen} onClose={() => setMenuOpen(false)} width={224}>
        <div className="overflow-hidden rounded-2xl border border-edge bg-raised py-1.5 shadow-[0_24px_60px_-15px_rgba(0,0,0,0.7)]">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void setTo(s)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-[13.5px] transition-colors ${
                s === status ? "text-ink" : "text-ink-muted hover:bg-elevated/60 hover:text-ink"
              }`}
            >
              {t(STATUS_LABELS[s])}
              {s === status && <Check size={15} className="text-ink" />}
            </button>
          ))}
          <div className="my-1 h-px bg-edge-soft" />
          <button
            type="button"
            onClick={() => void togglePrivate()}
            className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-[13.5px] transition-colors ${
              privacy ? "text-ink" : "text-ink-muted hover:bg-elevated/60 hover:text-ink"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Lock size={14} />
              {t("Private")}
            </span>
            {privacy && <Check size={15} className="shrink-0 text-ink" />}
          </button>
          {availableLists.length > 0 && (
            <>
              <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {t("Custom lists")}
              </div>
              {availableLists.map((name) => {
                const included = entryLists.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => void toggleList(name)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-start text-[13.5px] transition-colors ${
                      included ? "text-ink" : "text-ink-muted hover:bg-elevated/60 hover:text-ink"
                    }`}
                  >
                    <span className="truncate">{name}</span>
                    {included && <Check size={15} className="shrink-0 text-ink" />}
                  </button>
                );
              })}
            </>
          )}
          <div className="my-1 h-px bg-edge-soft" />
          <button
            type="button"
            onClick={() => void remove()}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-[13.5px] text-ink-muted transition-colors hover:bg-danger/15 hover:text-danger"
          >
            <Trash2 size={14} />
            {t("Remove from list")}
          </button>
        </div>
      </AnchoredMenu>
    </>
  );
}
