import { useT } from "@/lib/i18n";
import { useTopRankModal, type TopRankDept } from "@/lib/top-rank-modal";

const DEPT_LABELS: Record<TopRankDept, string> = {
  Acting: "Top 100 Actor",
  Directing: "Top 100 Director",
  Production: "Top 100 Producer",
  Writing: "Top 100 Writer",
};

export function RankBadge({ rank, dept = "Acting" }: { rank: number; dept?: TopRankDept }) {
  const { open } = useTopRankModal();
  const t = useT();
  const label = t(DEPT_LABELS[dept]);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open(dept);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          open(dept);
        }
      }}
      title={`${label} · #${rank}`}
      className="absolute start-2 top-2 flex cursor-pointer items-center gap-0.5 rounded-md border border-edge-soft/60 bg-canvas/95 px-1.5 py-0.5 text-[10.5px] font-bold text-ink transition-[transform,border-color,background-color] hover:scale-105 hover:border-accent/60 hover:bg-canvas"
    >
      <span className="text-[8.5px] uppercase tracking-[0.18em] text-ink-subtle">{t("Top")}</span>
      <span className="text-accent">{rank}</span>
    </span>
  );
}
