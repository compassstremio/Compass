import { Blocks, Download, FlaskConical, Loader2, RotateCw } from "../icons";
import { useEffect, useId, useState } from "react";
import { useSettings } from "@/lib/settings";
import {
  readChannelPreference,
  selectedUpdateChannel,
  updateHeaders,
} from "@/lib/updater/channel";
import { readBetaReturnContext } from "@/lib/updater/beta-return";
import {
  openModify,
  probeHandoff,
  probeModify,
  readModifyPlan,
  stageHandoff,
  type ModifyProbe,
  type StageProgress,
} from "@/lib/updater/handoff";
import {
  checkForUpdate,
  setUpdateChannel,
  openUpdatePanel,
  updateAvailable,
  useUpdate,
} from "@/lib/updater/use-update";
import { IS_BETA_BUILD } from "@/lib/build-info";
import { useT } from "@/lib/i18n";
import { ToggleRow } from "../shared";
import { ROW_ACTION, ROW_ACTION_PRIMARY, SettingRow } from "../kit";

const QUAL =
  "inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-2 text-[13px] font-bold uppercase leading-[17px] tracking-[0.72px]";

export function BetaChannelRow() {
  const t = useT();
  const { settings, update } = useSettings();
  const u = useUpdate();
  const [error, setError] = useState<string | null>(null);
  const descriptionId = useId();
  const preference = readChannelPreference();
  const on = preference ? preference.normal === "beta" : settings.betaUpdates;
  const experimental = selectedUpdateChannel() === "experimental";
  const locked = experimental || u.status === "downloading" || u.status === "installing";
  return (
    <fieldset
      disabled={locked}
      className="min-w-0"
      aria-describedby={locked ? descriptionId : undefined}
    >
      <ToggleRow
        label={t("Get beta updates")}
        sub={t(
          "Receive early builds with the newest fixes before they reach the stable release. Betas can be rough around the edges; switch this off to return to stable at the next update.",
        )}
        leading={
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-md ${
              on ? "bg-accent-soft text-accent" : "bg-raised text-ink-subtle"
            }`}
          >
            <FlaskConical size={16} strokeWidth={2.2} />
          </span>
        }
        value={on}
        onChange={(betaUpdates) => {
          if (!setUpdateChannel(betaUpdates ? "beta" : "stable")) {
            setError(t("Couldn't save the update channel. Free some storage and try again."));
            return;
          }
          setError(null);
          update({ betaUpdates });
        }}
      />
      {locked && (
        <p id={descriptionId} className="px-4 py-2 text-[12px] text-ink-subtle">
          {experimental
            ? t("Leave experimental builds before changing your normal update channel.")
            : t("Finish the current download or installation before changing channels.")}
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function UpdatesRow() {
  const t = useT();
  const u = useUpdate();
  const installedExperimental = readBetaReturnContext(__APP_VERSION__);
  const ready = u.intent !== "return-beta" && updateAvailable(u);
  const busy = u.intent === "return-beta" || u.status === "checking" || u.status === "installing";
  const status =
    u.intent === "return-beta"
      ? t("Continue the return to beta in Experimental builds below.")
      : u.status === "checking"
        ? t("Checking compass.sarl for a newer build.")
        : u.status === "downloading"
          ? t("Downloading {pct}%", { pct: Math.round(u.progress * 100) })
          : u.status === "downloaded"
            ? t("Downloaded. Ready to install and restart.")
            : u.status === "installing"
              ? t("Installing. Compass will restart.")
              : u.status === "available"
                ? t("A new version is ready to download.")
                : u.status === "unavailable"
                  ? u.error
                  : u.status === "uptodate"
                    ? u.channel === "experimental"
                      ? t("No newer experimental build is available for this device.")
                      : t("You're on the latest version.")
                    : u.status === "error" && u.manualCheck
                      ? t("Couldn't reach the update server. Try again in a moment.")
                      : t("Compass checks automatically every few hours.");
  return (
    <SettingRow
      icon={
        <RotateCw
          size={20}
          strokeWidth={2}
          className={`${ready ? "text-accent" : "text-ink-muted"} ${busy ? "animate-spin" : ""}`}
        />
      }
      label={
        <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0">
            {ready && u.channel === "experimental" && u.experimentalVersion
              ? `${t("Experimental")} ${u.experimentalVersion}`
              : ready && u.version
                ? t("Compass {version} available", { version: u.version })
                : installedExperimental
                  ? `${t("Experimental")} ${installedExperimental.experimentalVersion}`
                  : `Compass ${__APP_VERSION__}`}
          </span>
          {u.channel === "experimental" ? (
            <span className={`${QUAL} bg-accent-soft text-accent`}>{t("Experimental")}</span>
          ) : IS_BETA_BUILD ? (
            <span className={`${QUAL} bg-accent-soft text-accent`}>{t("Beta")}</span>
          ) : null}
        </span>
      }
      desc={status}
    >
      {ready ? (
        <button type="button" onClick={openUpdatePanel} className={ROW_ACTION_PRIMARY}>
          <Download size={16} strokeWidth={2.2} />
          {t("Update now")}
        </button>
      ) : (
        <button
          type="button"
          onClick={busy ? undefined : () => void checkForUpdate(true)}
          aria-disabled={busy}
          className={`${ROW_ACTION}${busy ? " pointer-events-none opacity-45" : ""}`}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RotateCw size={16} strokeWidth={2.2} />
          )}
          {busy ? t("Checking") : t("Check for updates")}
        </button>
      )}
    </SettingRow>
  );
}

/**
 * Changes which optional features are installed by opening Compass Setup. A setup left behind by
 * an update is reused when its signature still verifies; otherwise the user is asked first,
 * because continuing downloads the full installer again.
 */
export function ModifyInstallationRow() {
  const t = useT();
  const [managed, setManaged] = useState(false);
  const [local, setLocal] = useState<ModifyProbe | null>(null);
  const [ask, setAsk] = useState<"local" | "download" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StageProgress | null>(null);

  useEffect(() => {
    let live = true;
    void probeHandoff().then((probe) => {
      if (live) setManaged(probe?.managed === true);
    });
    return () => {
      live = false;
    };
  }, []);

  // Only a managed install has features to change at all.
  if (!managed) return null;

  const check = async () => {
    setError(null);
    setBusy(true);
    try {
      const found = await probeModify();
      setLocal(found?.found ? found : null);
      setAsk(found?.found ? "local" : "download");
    } finally {
      setBusy(false);
    }
  };

  const openLocal = async () => {
    setBusy(true);
    setError(null);
    try {
      await openModify(local?.path);
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  const downloadAndOpen = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const plan = await readModifyPlan(updateHeaders(selectedUpdateChannel()));
      if (!plan) {
        throw new Error(
          t("The update service has no installer available right now. Try again later."),
        );
      }
      await stageHandoff(plan, (p) => setProgress(p));
      await openModify();
    } catch (e) {
      setBusy(false);
      setProgress(null);
      setError(String(e));
    }
  };

  const reset = () => {
    setAsk(null);
    setLocal(null);
    setError(null);
    setProgress(null);
  };

  const pct =
    progress && progress.total
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  const desc =
    ask === "local"
      ? t(
          "Compass Setup {version} is already on this PC from your last update. Open it to change which features are installed; nothing changes unless you finish the installer.",
          { version: local?.version || "" },
        )
      : ask === "download"
        ? t(
            "Compass Setup isn't on this PC. Continuing downloads the full installer again and opens it, where you can change which features are installed.",
          )
        : t(
            "Add or remove optional features — extensions, games, and the Music, eBook and Manga tabs. Changing them opens Compass Setup.",
          );

  return (
    <SettingRow
      icon={<Blocks size={20} strokeWidth={2} className="text-ink-muted" />}
      label={t("Modify installation")}
      desc={desc}
    >
      {busy && progress ? (
        <span className="text-[12px] text-ink-muted">
          {progress.verifying
            ? t("Verifying the download…")
            : pct != null
              ? t("Downloading {pct}%", { pct })
              : t("Downloading…")}
        </span>
      ) : ask ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={reset} className={ROW_ACTION} disabled={busy}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={ask === "local" ? openLocal : downloadAndOpen}
            className={ROW_ACTION_PRIMARY}
            disabled={busy}
          >
            {ask === "local" ? t("Open Compass Setup") : t("Download and open")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={busy ? undefined : check}
          aria-disabled={busy}
          className={`${ROW_ACTION}${busy ? " pointer-events-none opacity-45" : ""}`}
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Blocks size={16} strokeWidth={2.2} />
          )}
          {t("Modify installation")}
        </button>
      )}
      {error && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </SettingRow>
  );
}
