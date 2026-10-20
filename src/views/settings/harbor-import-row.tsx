import { Download, Info } from "./icons";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/lib/i18n";
import { ROW_DESC, SettingRow, SettingsModal } from "./kit";
import { SButton } from "./ui";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type HarborImportStatus = { available: boolean; imported: boolean };

/**
 * Harbor is Compass's former name and kept its data in its own folders. Shown only when a
 * Harbor install exists; the import itself runs on the next start (src-tauri/src/harbor_import.rs).
 */
export function HarborImportRow() {
  const t = useT();
  const [status, setStatus] = useState<HarborImportStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    void invoke<HarborImportStatus>("harbor_import_status")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.available) return null;

  const start = async () => {
    setStarting(true);
    setFailed(false);
    try {
      await invoke("harbor_import_request");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setStarting(false);
      setFailed(true);
    }
  };

  return (
    <>
      <SettingRow
        icon={<Download size={20} strokeWidth={2.1} className="text-accent" />}
        label={t("Import from Harbor")}
        desc={
          status.imported
            ? t("Your Harbor data was already brought over. Import it again to replace what Compass has now.")
            : t("Harbor is Compass's former name. Bring over its profiles, settings, lists, keys and connected accounts.")
        }
      >
        <SButton variant={status.imported ? undefined : "primary"} onClick={() => setConfirming(true)}>
          <Download size={16} strokeWidth={2.4} />
          {t("Import")}
        </SButton>
      </SettingRow>

      {confirming && (
        <SettingsModal
          open
          onClose={() => setConfirming(false)}
          dismissible={!starting}
          title={t("Import your Harbor data?")}
          sub={t(
            "Compass restarts and replaces its current data with your Harbor setup. Close Harbor first.",
          )}
          actions={
            <>
              <SButton disabled={starting} onClick={() => setConfirming(false)}>
                {t("Cancel")}
              </SButton>
              <SButton variant="primary" disabled={starting} onClick={() => void start()}>
                {starting ? t("Restarting...") : t("Import and restart")}
              </SButton>
            </>
          }
        >
          {failed && (
            <p role="alert" className="text-[15px] text-danger">
              {t("Compass could not start the import. Try again.")}
            </p>
          )}
          <div className="flex items-start gap-2.5 rounded-[10px] bg-elevated px-4 py-3">
            <Info size={18} className="mt-[2px] shrink-0 text-ink-subtle" />
            <p className={`max-w-[66ch] ${ROW_DESC}`}>
              {t(
                "Nothing is deleted: Compass keeps its current data in a backup folder next to its own, and Harbor stays as it is.",
              )}
            </p>
          </div>
        </SettingsModal>
      )}
    </>
  );
}
