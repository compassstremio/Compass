import { CompassMark } from "@/components/icons/compass-mark";
import { useT } from "@/lib/i18n";
import { openUrl } from "@/lib/window";

export function MobileNotice() {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-canvas px-8 text-center">
      <div className="flex items-center gap-3 text-ink">
        <CompassMark className="h-9 w-9" />
        <span className="font-display text-[36px] font-semibold leading-none tracking-tight">
          Compass
        </span>
      </div>
      <div className="flex max-w-md flex-col gap-3.5">
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">
          {t("Built for desktop resolutions")}
        </h1>
        <p className="text-[14.5px] leading-relaxed text-ink-muted">
          {t(
            "This instance of Compass is made for desktop. Our standalone iOS and Android apps are coming soon, each with a bespoke, mobile-first experience built for its native platform.",
          )}
        </p>
        <p className="text-[14.5px] leading-relaxed text-ink-muted">
          {t("For now, please open this site on a desktop, or build Compass from source.")}
        </p>
      </div>
      <a
        href="https://github.com/compassstremio/compass"
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.preventDefault();
          openUrl("https://github.com/compassstremio/compass");
        }}
        className="flex h-11 items-center justify-center rounded-full bg-elevated px-6 text-[14px] font-semibold text-ink ring-1 ring-edge-soft transition-colors hover:bg-raised"
      >
        {t("Build from source")}
      </a>
    </div>
  );
}
