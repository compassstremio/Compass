import { useState } from "react";
import { CompassMark } from "@/components/icons/compass-mark";
import { useCompassLogo } from "@/lib/compass-logo";
import "./menu-brand-footer.css";

/** Decorative identity for the root context menu, never a menu item. */
export function MenuBrandFooter() {
  const { mark, wordmark } = useCompassLogo();
  const [failedMark, setFailedMark] = useState<string | null>(null);
  const [failedWordmark, setFailedWordmark] = useState<string | null>(null);
  return (
    <div data-context-brand-footer aria-hidden className="context-menu-brand-footer">
      {mark && mark !== failedMark ? (
        <img
          src={mark}
          alt=""
          draggable={false}
          className="context-menu-brand-mark"
          onError={() => setFailedMark(mark)}
        />
      ) : (
        <CompassMark className="context-menu-brand-mark" />
      )}
      {wordmark && wordmark !== failedWordmark && (
        <img
          src={wordmark}
          alt=""
          draggable={false}
          className="context-menu-brand-wordmark"
          onError={() => setFailedWordmark(wordmark)}
        />
      )}
    </div>
  );
}
