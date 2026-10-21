import {
  COMPASS_MARK_DIAL_D,
  COMPASS_MARK_NEEDLE_D,
  COMPASS_MARK_TICKS_D,
  COMPASS_MARK_VIEW_BOX,
} from "@/components/icons/compass-mark";

/**
 * Compass's mark, taken apart so the setup flow can build it one confirmed step
 * at a time: the dial first, then its ticks, then the needle. Each part gets its
 * own <svg> so every hoist transform is plain CSS pixels.
 */
const VIEW_BOX = COMPASS_MARK_VIEW_BOX;

type Part = "hull" | "jib" | "sail";

/** Earned order. The dial is the first thing that exists, the needle lands last. */
const BUILD_ORDER: readonly Part[] = ["hull", "jib", "sail"];
/** Paint order. The needle sits over the dial. */
const PAINT_ORDER: readonly Part[] = ["hull", "jib", "sail"];

export const BOAT_PARTS = BUILD_ORDER.length;

// Part keys keep their old names so the hoist animations in CSS still apply.
const PATH_OF: Record<Part, string> = {
  hull: COMPASS_MARK_DIAL_D,
  jib: COMPASS_MARK_TICKS_D,
  sail: COMPASS_MARK_NEEDLE_D,
};
const HOIST_OF: Record<Part, string> = {
  hull: "setup-hoist-hull",
  jib: "setup-hoist-jib",
  sail: "setup-hoist-sail",
};
const LAG = ["", "setup-lag-1", "setup-lag-2"];

/** How much of the boat a run of steps is worth, so a one-step queue still
    finishes with a whole boat and a skipped step never fakes one. */
export function boatBuilt(confirmed: number, total: number): number {
  if (total <= 0 || confirmed <= 0) return 0;
  return Math.min(BOAT_PARTS, Math.ceil((BOAT_PARTS * confirmed) / total));
}

export function SetupBoat({
  built,
  animate = "none",
  ghost,
  className,
}: {
  built: number;
  animate?: "none" | "latest" | "all";
  /** Draws the parts not yet earned at a whisper, so the shape the viewer is
      filling in is visible from the first screen and each hoist lands into
      something. Off at the finish, where a missing sail would only nag. */
  ghost?: boolean;
  className?: string;
}) {
  return (
    <span className={`setup-boat ${className ?? ""}`} aria-hidden>
      {PAINT_ORDER.map((part) => {
        const step = BUILD_ORDER.indexOf(part);
        const earned = step < built;
        if (!earned && !ghost) return null;
        const hoist = !earned
          ? "opacity-[0.11]"
          : animate === "all"
            ? `${HOIST_OF[part]} ${LAG[step]}`
            : animate === "latest" && step === built - 1
              ? HOIST_OF[part]
              : "";
        return (
          <svg key={part} viewBox={VIEW_BOX} fill="currentColor" className={`setup-boat-part ${hoist}`}>
            <path fillRule="evenodd" d={PATH_OF[part]} />
          </svg>
        );
      })}
    </span>
  );
}
