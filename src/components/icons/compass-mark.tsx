/** Compass's mark: dial, four ticks and needle on an 864-unit square. Each part
    is its own path so themes can recolor the dial and the needle separately. */
export const COMPASS_MARK_VIEW_BOX = "0 0 864 864";
export const COMPASS_MARK_DIAL_D =
  "M432 5a431 426.5 0 1 0 0 853a431 426.5 0 1 0 0-853Zm0 41a390 385.5 0 1 1 0 771a390 385.5 0 1 1 0-771Z";
export const COMPASS_MARK_TICKS_D = "M412 30h44v106h-44ZM412 725h44v110h-44ZM26 415h95v40H26ZM744 415h95v40h-95Z";
export const COMPASS_MARK_NEEDLE_D = "M674 206 485 487 202 651 381 382ZM432 400a37 37 0 1 0 0 74a37 37 0 1 0 0-74Z";

export function CompassMark({ className }: { className?: string }) {
  return (
    <svg viewBox={COMPASS_MARK_VIEW_BOX} fill="currentColor" aria-hidden className={className}>
      <path className="compass-mark-dial" fillRule="evenodd" d={COMPASS_MARK_DIAL_D} />
      <path className="compass-mark-dial" d={COMPASS_MARK_TICKS_D} />
      <path className="compass-mark-needle" fillRule="evenodd" d={COMPASS_MARK_NEEDLE_D} />
    </svg>
  );
}
