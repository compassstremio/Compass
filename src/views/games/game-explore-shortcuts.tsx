import type { RefObject } from "react";
import { useT } from "@/lib/i18n";

const destinations = [
  ["games.discovery.worldsTitle", ".games-franchise-worlds", "worlds"],
  ["games.studios.title", ".games-studios", "studios"],
  ["games.romShowcase.title", ".games-rom-showcase", "rom-hacks"],
  ["games.launchers.explore", ".games-launchers", "launchers"],
  ["games.feed.title", ".games-news-feed", "news"],
  ["games.charts.title", ".games-discovery-desk", "charts"],
] as const;

/** Far rows mount lazily; give the section and the rows above it this long to settle. */
const SETTLE_LIMIT_MS = 2500;
const SETTLE_FRAMES = 6;

function reveal(section: HTMLElement, behavior: ScrollBehavior) {
  const heading = section.querySelector<HTMLElement>("h2");
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  section.scrollIntoView({ block: "start", behavior });
}

function goTo(scroll: HTMLElement, row: string, selector: string) {
  const mounted = scroll.querySelector<HTMLElement>(selector);
  if (mounted) { reveal(mounted, matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"); return; }
  // The row wrapper always exists. Jumping to it mounts the section, then rows above it may grow.
  const wrapper = scroll.querySelector<HTMLElement>(`[data-page-row="${row}"]`);
  if (!wrapper) return;
  wrapper.scrollIntoView({ block: "start", behavior: "instant" });
  const started = performance.now();
  let lastTop = Number.NaN, still = 0;
  const settle = () => {
    const section = scroll.querySelector<HTMLElement>(selector);
    const top = section?.getBoundingClientRect().top ?? Number.NaN;
    still = Math.abs(top - lastTop) < 1 ? still + 1 : 0;
    lastTop = top;
    const expired = performance.now() - started > SETTLE_LIMIT_MS;
    if (section && (still >= SETTLE_FRAMES || expired)) { reveal(section, "instant"); return; }
    if (expired) { wrapper.scrollIntoView({ block: "start", behavior: "instant" }); return; }
    requestAnimationFrame(settle);
  };
  requestAnimationFrame(settle);
}

export function GameExploreShortcuts({scrollRef, hiddenRows = []}:{scrollRef:RefObject<HTMLElement|null>; hiddenRows?: string[]}) {
  const t=useT();
  return <nav className="games-explore-shortcuts games-inset" aria-label={t("games.liveCatalog")}>
    {destinations.filter(([, , id]) => !hiddenRows.includes(id)).map(([label,selector,id])=><button key={selector} onClick={()=>{
      if(scrollRef.current)goTo(scrollRef.current,id,selector);
    }}>{t(label)}</button>)}
  </nav>;
}
