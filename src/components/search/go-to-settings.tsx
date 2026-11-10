import { CornerDownLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useView } from "@/lib/view";
import { useNavSearch } from "@/views/settings/nav";
import { GO_TO_ROW } from "./go-to-section";

const MAX_OPTIONS = 4;

export default function GoToSettings({
  query,
  onClose,
}: {
  query: string;
  onClose: () => void;
}) {
  const t = useT();
  const { openSettings } = useView();
  const { matches, optionMatches } = useNavSearch(query.trim().toLowerCase());

  const rows: { key: string; label: string; section: Parameters<typeof openSettings>[0] }[] = [];
  for (const o of optionMatches ?? []) {
    if (rows.length >= MAX_OPTIONS) break;
    rows.push({ key: `o:${o.section}:${o.label}`, label: o.label, section: o.section });
  }
  if (rows.length === 0) {
    for (const s of matches ?? []) {
      if (rows.length >= 2) break;
      rows.push({ key: `s:${s.id}`, label: s.label, section: s.id });
    }
  }
  if (rows.length === 0) return null;

  return (
    <>
      <span className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
        {t("Settings")}
      </span>
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          className={GO_TO_ROW}
          onClick={() => {
            onClose();
            openSettings(row.section);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{t(row.label)}</span>
          <CornerDownLeft size={14} className="shrink-0 text-ink-subtle dir-icon" />
        </button>
      ))}
    </>
  );
}
