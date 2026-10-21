import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { fetchFirstTrailer, resolveTrailerQuality, trailerSrc, type TrailerInfo } from "@/lib/trailer";
import { useTrailerVideo } from "@/lib/use-trailer-video";
import { useSettings } from "@/lib/settings";
import { usePageVisible } from "@/lib/visibility";
import { useT } from "@/lib/i18n";

const VIDEO_CLASS = "absolute inset-0 h-full w-full object-cover";

export function DetailHeroTrailer({
  candidateIds,
  paused = false,
}: {
  candidateIds: readonly string[];
  paused?: boolean;
}) {
  const t = useT();
  const { settings } = useSettings();
  const [info, setInfo] = useState<TrailerInfo | null>(null);
  const [muted, setMuted] = useState(!settings.detailTrailerAudio);
  const pageVisible = usePageVisible();
  const wantsPlayback = !!info && !paused && pageVisible;
  const { slot, ready } = useTrailerVideo({
    src: info ? trailerSrc(info) : null,
    active: !!info && pageVisible,
    playing: wantsPlayback,
    muted,
    volume: 1,
    onAutoplayMuted: () => setMuted(true),
    className: VIDEO_CLASS,
    loop: true,
  });

  useEffect(() => {
    setInfo(null);
    setMuted(!settings.detailTrailerAudio);
    if (candidateIds.length === 0) return;
    let cancelled = false;
    fetchFirstTrailer(candidateIds, resolveTrailerQuality(settings.autoplayTrailerQuality), () => !cancelled).then((i) => {
      if (!cancelled) setInfo(i);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateIds, settings.autoplayTrailerQuality]);

  return (
    <>
      <div
        ref={slot}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-700"
        style={{ opacity: wantsPlayback && ready ? 1 : 0 }}
      />
      {wantsPlayback && ready && (
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? t("Unmute trailer") : t("Mute trailer")}
          title={muted ? t("Unmute trailer") : t("Mute trailer")}
          className="absolute bottom-8 end-8 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/75"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      )}
    </>
  );
}
