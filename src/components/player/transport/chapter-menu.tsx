import { ListTree, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter } from "@/lib/player/bridge";
import { useT } from "@/lib/i18n";
import { watchOutsideMouseDown } from "@/lib/player/overlay-dismiss";
import { Tooltip } from "./tooltip";
import { fmtTime } from "./transport-utils";

export function ChapterMenu({
  chapters,
  positionSec,
  onSeek,
  onOpenChange,
  iconUrl,
}: {
  chapters: Chapter[];
  positionSec: number;
  onSeek: (sec: number) => void;
  onOpenChange?: (open: boolean) => void;
  iconUrl?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const ordered = useMemo(
    () =>
      [...chapters]
        .filter((chapter) => Number.isFinite(chapter.startSec))
        .sort((a, b) => a.startSec - b.startSec),
    [chapters],
  );
  const activeIndex = ordered.reduce(
    (found, chapter, index) => (chapter.startSec <= positionSec + 0.25 ? index : found),
    -1,
  );

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // The transport keeps its chrome visible while a menu is open. Chapters can
  // disappear mid-menu (a stream switch to a file without them), and the control
  // unmounts then, so it has to release that flag itself.
  useEffect(() => {
    if (ordered.length === 0 && open) setOpen(false);
  }, [ordered.length, open]);
  useEffect(
    () => () => {
      if (openRef.current) onOpenChangeRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Shared with the other player menus: it also notes the dismissal so the
    // click that closes this menu is not read as a play/pause tap underneath.
    const stopWatching = watchOutsideMouseDown(close);
    window.addEventListener("keydown", escape);
    return () => {
      stopWatching();
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!ordered.length) return null;
  return (
    <div ref={wrap} className="relative">
      <Tooltip label={t("Chapters")}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={t("Chapters")}
          aria-expanded={open}
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
            open ? "bg-white/22 text-white" : "text-white/85 hover:bg-white/10 hover:text-white"
          }`}
        >
          {iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              className="h-[22px] w-[22px] shrink-0 select-none object-contain"
              draggable={false}
            />
          ) : (
            <ListTree size={19} strokeWidth={2} />
          )}
        </button>
      </Tooltip>
      {open && (
        <div className="fixed end-14 bottom-[150px] flex max-h-[calc(100vh-174px)] w-[360px] max-w-[calc(100vw-72px)] flex-col overflow-hidden rounded-md bg-elevated shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] animate-menu-pop">
          <header className="flex items-center justify-between border-b border-edge-soft px-4 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-[13.5px] font-semibold text-ink">{t("Chapters")}</span>
              <span className="text-[11.5px] tabular-nums text-ink-subtle">{ordered.length}</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("Close chapters")}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <X size={13} strokeWidth={2.2} />
            </button>
          </header>
          <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
            {ordered.map((chapter, index) => {
              const isCurrent = index === activeIndex;
              return (
                <button
                  type="button"
                  key={`${chapter.startSec}-${index}`}
                  onClick={() => {
                    onSeek(chapter.startSec);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors ${
                    isCurrent ? "bg-elevated ring-1 ring-edge" : "hover:bg-canvas/55"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold tabular-nums ${
                      isCurrent ? "bg-accent text-canvas" : "bg-raised text-ink-subtle"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[12.5px] leading-snug ${
                      isCurrent ? "font-medium text-ink" : "text-ink-muted"
                    }`}
                  >
                    {chapter.title || t("Chapter {chapter}", { chapter: index + 1 })}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ink-subtle">
                    {fmtTime(chapter.startSec)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
