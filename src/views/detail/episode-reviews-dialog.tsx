import { useEffect, useId, useMemo, useState } from "react";
import { ExternalLink, Heart, Loader2, MessageSquareText, Star, X } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import type { Meta } from "@/lib/cinemeta";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";
import {
  fetchEpisodeReviews,
  sortEpisodeReviews,
  type EpisodeReview,
  type EpisodeReviews,
  type EpisodeReviewSort,
} from "@/lib/episode-reviews";

const SORTS: { key: EpisodeReviewSort; label: string }[] = [
  { key: "liked", label: "Most liked" },
  { key: "recent", label: "Most recent" },
  { key: "highest", label: "Highest rated" },
  { key: "lowest", label: "Lowest rated" },
  { key: "longest", label: "Longest" },
];

const LONG_REVIEW = 700;

export function EpisodeReviewsDialog({
  seriesImdbId,
  season,
  episode,
  episodeTitle,
  showTitle,
  onClose,
}: {
  seriesImdbId: string;
  season: number;
  episode: number;
  episodeTitle?: string;
  showTitle?: string;
  onClose: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const { closing, close } = useModalExit(onClose);
  const [data, setData] = useState<EpisodeReviews | null>(null);
  const [sort, setSort] = useState<EpisodeReviewSort>("liked");

  useEffect(() => {
    let live = true;
    setData(null);
    fetchEpisodeReviews(seriesImdbId, season, episode).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [seriesImdbId, season, episode]);

  const reviews = useMemo(() => (data ? sortEpisodeReviews(data.reviews, sort) : []), [data, sort]);

  const subtitle = [showTitle, `S${season} E${episode}`, episodeTitle].filter(Boolean).join(" · ");

  return (
    <ModalShell closing={closing} onDismiss={close} width={780} labelledBy={titleId}>
      <div className="flex items-start gap-4 px-6 pt-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[10.5px] font-bold uppercase tracking-[0.18em] text-ink-subtle">{subtitle}</span>
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-ink">
            {t("Episode reviews")}
          </h2>
          {data && (
            <span className="text-[12px] text-ink-subtle">
              IMDb {data.imdbCount} · Trakt {data.traktCount}
              {data.average != null && ` · ★ ${data.average.toFixed(1)}/10`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-subtle transition-colors hover:bg-elevated hover:text-ink"
          aria-label={t("Close")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 px-6 pb-3 pt-4" role="group" aria-label={t("Sort reviews")}>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={sort === s.key}
            onClick={() => setSort(s.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              sort === s.key ? "bg-ink text-canvas" : "bg-white/[0.06] text-ink-muted hover:bg-white/[0.10] hover:text-ink"
            }`}
          >
            {t(s.label)}
          </button>
        ))}
      </div>

      <div className="flex min-h-[240px] flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {!data && (
          <p className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-muted">
            <Loader2 size={14} className="animate-spin" />
            {t("Gathering reviews from IMDb and Trakt…")}
          </p>
        )}
        {data && reviews.length === 0 && (
          <p className="py-16 text-center text-[14px] text-ink-muted">{t("No reviews for this episode yet.")}</p>
        )}
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
    </ModalShell>
  );
}

function ReviewCard({ review }: { review: EpisodeReview }) {
  const t = useT();
  const [revealed, setRevealed] = useState(!review.spoiler);
  const [expanded, setExpanded] = useState(false);
  const long = review.text.length > LONG_REVIEW;

  return (
    <article className="rounded-xl bg-elevated p-4 ring-1 ring-edge">
      <div className="flex flex-wrap items-center gap-2">
        {review.avatar ? (
          <img
            src={review.avatar}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-muted/20 text-[13px] font-semibold text-ink-muted">
            {review.author.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-[13px] font-semibold text-ink">{review.author}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide ${
            review.source === "imdb" ? "bg-[#f5c518] text-black" : "bg-[#ed1c24] text-white"
          }`}
        >
          {review.source === "imdb" ? "IMDb" : "Trakt"}
        </span>
        {review.rating != null && (
          <span className="flex items-center gap-1 text-[12.5px] font-semibold text-amber-300">
            <Star size={12} fill="currentColor" strokeWidth={0} />
            {review.rating}/10
          </span>
        )}
        <span className="ms-auto flex items-center gap-3 text-[11.5px] text-ink-subtle">
          {review.likes > 0 && (
            <span className="flex items-center gap-1">
              <Heart size={11} />
              {review.likes}
            </span>
          )}
          {review.date &&
            new Date(review.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
          {review.url && (
            <button
              type="button"
              onClick={() => review.url && openUrl(review.url)}
              aria-label={t("Open original review")}
              className="text-ink-subtle transition-colors hover:text-ink"
            >
              <ExternalLink size={12} />
            </button>
          )}
        </span>
      </div>
      {review.title && (
        <h3 className="mt-2 text-[14px] font-semibold text-ink" dir="auto">
          {review.title}
        </h3>
      )}
      <div className="relative mt-1.5">
        <p
          dir="auto"
          className={`whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-muted ${
            long && !expanded ? "line-clamp-[7]" : ""
          } ${revealed ? "" : "select-none blur-[6px]"}`}
        >
          {review.text}
        </p>
        {!revealed && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 grid place-items-center text-[12.5px] font-semibold text-ink"
          >
            {t("Contains spoilers. Click to reveal")}
          </button>
        )}
      </div>
      {long && revealed && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[12px] font-semibold text-ink transition-colors hover:text-amber-300"
        >
          {expanded ? t("Show less") : t("Read more")}
        </button>
      )}
    </article>
  );
}

/** "Reviews" button for an episode row; opens the dialog. Hidden when the show has no IMDb id. */
export function EpisodeReviewsButton({
  meta,
  seriesImdbId,
  season,
  episode,
  episodeTitle,
  compact = false,
}: {
  meta: Meta;
  seriesImdbId?: string | null;
  season: number;
  episode: number;
  episodeTitle?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const imdbId = seriesImdbId ?? (/^tt\d+/.exec(meta.id)?.[0] ?? null);
  if (!imdbId) return null;
  return (
    <>
      <HoverTooltip label={t("Episode reviews")} align="center" className="shrink-0 self-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={t("Episode reviews")}
          className={`flex items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
            compact ? "p-1.5" : "h-10 w-10"
          }`}
        >
          <MessageSquareText size={compact ? 16 : 18} strokeWidth={2} />
        </button>
      </HoverTooltip>
      {open && (
        <EpisodeReviewsDialog
          seriesImdbId={imdbId}
          season={season}
          episode={episode}
          episodeTitle={episodeTitle}
          showTitle={meta.name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
