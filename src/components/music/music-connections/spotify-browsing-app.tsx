import { useState } from "react";
import { LoaderCircle } from "@/components/icons/music-icons";
import { useT } from "@/lib/i18n";
import { connectSpotifyBrowsing } from "@/lib/music/spotify-setup";
import { guardMusicSource } from "@/lib/music/source-consent";

/**
 * The paired session drives playback on librespot's desktop client, whose Web API quota is
 * shared by every librespot user and saturates constantly. Signing in with the listener's
 * own app gives browsing its own quota without touching playback.
 */
export function SpotifyBrowsingApp({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const connect = () => {
    if (!guardMusicSource("spotify", connect)) return;
    setBusy(true);
    setFailure(null);
    void connectSpotifyBrowsing()
      .then(() => onDone())
      .catch((reason) => setFailure(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="border-t border-edge-soft px-4 py-4">
      <p className="text-[13px] font-semibold leading-6 text-ink">
        {t("music.spotifyBrowse.title")}
      </p>
      <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-muted">
        {t("music.spotifyBrowse.body")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="inline-flex h-11 min-w-28 items-center justify-center gap-2 rounded-full border border-edge px-4 text-[12px] font-medium text-ink transition-colors duration-200 ease-out hover:bg-elevated disabled:opacity-40"
        >
          {busy && <LoaderCircle size={20} className="animate-spin" />}
          {busy ? t("music.connect.connecting") : t("music.spotifyBrowse.action")}
        </button>
      </div>
      {failure && (
        <p role="alert" className="mt-2 text-[13px] leading-5 text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
