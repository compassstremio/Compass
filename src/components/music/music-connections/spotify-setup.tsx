import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "@/components/icons/music-icons";
import { copyText } from "@/components/player/copy-link-button";
import { useT } from "@/lib/i18n";
import "@/components/music/music-connect-field.css";
import {
  SPOTIFY_DASHBOARD_URL,
  SPOTIFY_REDIRECT_URI,
  cancelSpotifyDevicePairing,
  pollSpotifyDevicePairing,
  startSpotifyDevicePairing,
  type SpotifyDevicePrompt,
} from "@/lib/music/spotify-setup";
import { guardMusicSource } from "@/lib/music/source-consent";
import { openUrl } from "@/lib/window";

function text(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * The primary Spotify sign-in: pair this device with a code entered at spotify.com/pair.
 * The bring-your-own-app walkthrough below stays for listeners who want their own app.
 */
function SpotifyDevicePairing({
  disabled,
  onPaired,
}: {
  disabled: boolean;
  onPaired: () => void;
}) {
  const t = useT();
  const [prompt, setPrompt] = useState<SpotifyDevicePrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  const listening = useRef(false);
  const titleClass = "text-[13px] font-semibold leading-6 text-ink";
  const bodyClass = "mt-1 text-[13px] leading-5 text-ink-muted";

  useEffect(
    () => () => {
      listening.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const stop = () => {
    listening.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
  };

  const poll = (interval: number) => {
    timer.current = window.setTimeout(() => {
      if (!listening.current) return;
      void pollSpotifyDevicePairing()
        .then((result) => {
          if (!listening.current) return;
          if (result.state === "connected") {
            stop();
            setPrompt(null);
            onPaired();
            return;
          }
          poll(result.interval);
        })
        .catch((reason) => {
          if (!listening.current) return;
          stop();
          setPrompt(null);
          setFailure(text(reason));
        });
    }, Math.max(1, interval) * 1000);
  };

  const start = () => {
    if (!guardMusicSource("spotify", start)) return;
    setBusy(true);
    setFailure(null);
    setCopyState("idle");
    void startSpotifyDevicePairing()
      .then((next) => {
        setPrompt(next);
        listening.current = true;
        poll(next.interval);
      })
      .catch((reason) => setFailure(text(reason)))
      .finally(() => setBusy(false));
  };

  const cancel = () => {
    stop();
    setPrompt(null);
    void cancelSpotifyDevicePairing().catch(() => {});
  };

  const pairUrl =
    prompt?.verificationUriComplete ?? prompt?.verificationUri ?? "https://spotify.com/pair";

  return (
    <div className="max-w-2xl">
      <p className={titleClass}>{t("music.spotifySetup.pairTitle")}</p>
      <p className={bodyClass}>{t("music.spotifySetup.pairBody")}</p>
      {prompt ? (
        <div className="mt-3 grid gap-3 rounded-lg border border-edge bg-canvas/40 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0">
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                {t("music.spotifySetup.pairCodeLabel")}
              </span>
              <span
                className="mt-1 block font-mono text-[22px] font-semibold tracking-[0.28em] text-ink"
                dir="ltr"
              >
                {prompt.userCode}
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                void copyText(prompt.userCode).then((ok) =>
                  setCopyState(ok ? "copied" : "failed"),
                )
              }
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge px-4 text-[12px] font-medium text-ink hover:bg-elevated"
            >
              {copyState === "copied" ? (
                <Check size={17} aria-hidden="true" />
              ) : (
                <Copy size={17} aria-hidden="true" />
              )}
              {t(
                copyState === "copied"
                  ? "music.spotifySetup.pairCopied"
                  : "music.spotifySetup.pairCopy",
              )}
            </button>
          </div>
          <p role="status" aria-live="polite" className="text-[12.5px] leading-5 text-ink-muted">
            {t("music.spotifySetup.pairWaiting")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void openUrl(pairUrl)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-[12px] font-semibold text-canvas"
            >
              {t("music.spotifySetup.pairOpen")}
              <ExternalLink size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={cancel}
              className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-[12px] font-medium text-ink hover:bg-elevated"
            >
              {t("common.cancel")}
            </button>
          </div>
          {copyState === "failed" && (
            <p className="text-[12px] leading-5 text-ink-muted">
              {t("music.spotifySetup.pairCopyFailed")}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={disabled || busy}
          className="mt-3 inline-flex h-11 min-w-28 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[12px] font-semibold text-canvas disabled:opacity-40"
        >
          {busy ? t("music.connect.connecting") : t("music.spotifySetup.pairAction")}
        </button>
      )}
      {failure && (
        <p role="alert" className="mt-2 text-[13px] leading-5 text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}

export function SpotifySetupFields({
  clientId,
  onChange,
  disabled,
  onPaired,
}: {
  clientId: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onPaired: () => void;
}) {
  const t = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const stepClass = "grid grid-cols-[24px_minmax(0,1fr)] gap-3";
  const numberClass =
    "grid size-6 place-items-center rounded-full bg-elevated text-[12px] font-semibold text-ink-muted";
  const titleClass = "text-[13px] font-semibold leading-6 text-ink";
  const bodyClass = "mt-1 text-[13px] leading-5 text-ink-muted";

  return (
    <>
      <SpotifyDevicePairing disabled={disabled} onPaired={onPaired} />
      <div className="mt-6 max-w-2xl border-t border-edge-soft pt-4">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold leading-6 text-ink">
          {t("music.spotifySetup.pairManual")}
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
            {t("music.spotifySetup.browseRecommended")}
          </span>
        </p>
        <p className="mt-1 text-[13px] leading-5 text-ink-muted">
          {t("music.spotifySetup.browseBody")}
        </p>
      </div>
      <ol className="mt-4 grid max-w-2xl gap-5">
        <li className={stepClass}>
          <span className={numberClass} aria-hidden="true">
            1
          </span>
          <div>
            <p className={titleClass}>{t("music.spotifySetup.createTitle")}</p>
            <p className={bodyClass}>{t("music.spotifySetup.createBody")}</p>
            <button
              type="button"
              onClick={() => void openUrl(SPOTIFY_DASHBOARD_URL)}
              className="inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-ink hover:underline"
            >
              {t("music.spotifySetup.dashboard")}
              <ExternalLink size={15} aria-hidden="true" />
            </button>
          </div>
        </li>
        <li className={stepClass}>
          <span className={numberClass} aria-hidden="true">
            2
          </span>
          <div className="min-w-0">
            <p className={titleClass}>{t("music.spotifySetup.redirectTitle")}</p>
            <p className={bodyClass}>{t("music.spotifySetup.redirectBody")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={SPOTIFY_REDIRECT_URI}
                aria-label={t("music.spotifySetup.redirectLabel")}
                onFocus={(event) => event.currentTarget.select()}
                dir="ltr"
                className="h-11 min-w-0 flex-[1_1_240px] select-text rounded-md border border-edge bg-canvas px-3 font-mono text-[12px] text-ink outline-none focus:border-ink-muted"
              />
              <button
                type="button"
                onClick={() =>
                  void copyText(SPOTIFY_REDIRECT_URI).then((ok) =>
                    setCopyState(ok ? "copied" : "failed"),
                  )
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge px-4 text-[12px] font-medium text-ink hover:bg-elevated"
              >
                {copyState === "copied" ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  <Copy size={17} aria-hidden="true" />
                )}
                {t(
                  copyState === "copied"
                    ? "music.spotifySetup.copied"
                    : "music.spotifySetup.copyUri",
                )}
              </button>
            </div>
            <p
              role="status"
              className={
                copyState === "failed" ? "mt-1 text-[12px] leading-5 text-ink-muted" : "sr-only"
              }
            >
              {copyState === "failed"
                ? t("music.spotifySetup.copyFailed")
                : copyState === "copied"
                  ? t("music.spotifySetup.copied")
                  : null}
            </p>
          </div>
        </li>
        <li className={stepClass}>
          <span className={numberClass} aria-hidden="true">
            3
          </span>
          <label className="music-connect-field min-w-0">
            <span className={`block ${titleClass}`}>{t("music.spotifySetup.clientTitle")}</span>
            <input
              type="text"
              value={clientId}
              onChange={(event) => onChange(event.currentTarget.value)}
              disabled={disabled}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              aria-label={t("music.spotifySetup.clientTitle")}
              placeholder={t("music.spotifySetup.clientPlaceholder")}
              className="mt-2 h-11 w-full rounded-md border border-edge bg-canvas px-3 text-[14px] text-ink disabled:opacity-40"
            />
            <span className={`block ${bodyClass}`}>{t("music.spotifySetup.accountHint")}</span>
          </label>
        </li>
      </ol>
    </>
  );
}
