import { lazy, Suspense, useMemo } from "react";
import { CornerDownLeft } from "lucide-react";
import { useSidebarNavigation } from "@/chrome/context-page-navigation";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";

// The settings index is large, so it only loads once the user has typed something.
const GoToSettings = lazy(() => import("./go-to-settings"));

const MAX_ROOMS = 4;

export const GO_TO_ROW =
  "flex h-11 w-full items-center gap-3 rounded-xl px-4 text-start text-[14.5px] font-semibold text-ink transition-[background-color,transform] duration-150 hover:bg-elevated/70 focus-visible:bg-elevated/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99]";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Jump straight to a room or a settings page from the search box. */
export function GoToSection({ query, onClose }: { query: string; onClose: () => void }) {
  const t = useT();
  const { entries, kid, locked } = useSidebarNavigation();
  const { setView } = useView();
  const needle = normalize(query);

  const rooms = useMemo(() => {
    if (needle.length < 2) return [];
    return entries
      .filter(
        ({ item, gated }) =>
          !gated && (normalize(t(item.label)).includes(needle) || item.id.includes(needle)),
      )
      .slice(0, MAX_ROOMS);
  }, [entries, needle, t]);

  if (needle.length < 2) return null;

  return (
    <div className="compass-search-section mb-5 flex flex-col gap-1">
      {rooms.length > 0 && (
        <>
          <span className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
            {t("Go to")}
          </span>
          {rooms.map(({ item }) => (
            <button
              key={item.id}
              type="button"
              className={GO_TO_ROW}
              onClick={() => {
                onClose();
                setView(item.view as Parameters<typeof setView>[0]);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
              <CornerDownLeft size={14} className="shrink-0 text-ink-subtle dir-icon" />
            </button>
          ))}
        </>
      )}
      {!kid && !locked && (
        <Suspense fallback={null}>
          <GoToSettings query={query} onClose={onClose} />
        </Suspense>
      )}
    </div>
  );
}
