import { useEffect, useId, useRef, useState } from "react";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useT, useUiLanguage } from "@/lib/i18n";
import { useSectionBack } from "@/lib/section-back";
import type { PlayniteLibrary } from "@/hooks/use-playnite-library";
import { LibrarySourceMark } from "./game-library-marks";
import { useAccountDialogFocus } from "./game-steam-account";
import "./game-library-accounts.css";
import "./game-playnite-account.css";

export function GamePlayniteControl({ playnite, active }: { playnite: PlayniteLibrary; active: boolean }) {
  const t = useT(), [open, setOpen] = useState(false), origin = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  if (!playnite.available) return null;
  const { status } = playnite, connected = status.extension === "installed" && status.exportedAt > 0;
  const close = () => { setOpen(false); requestAnimationFrame(() => origin.current?.focus({ preventScroll: true })); };
  return <div className="games-library-account-control"><button ref={origin} className="games-button games-library-account-button" onClick={() => setOpen(true)}><LibrarySourceMark source="playnite" size={22}/>Playnite<span className="games-library-account-action">{t(connected ? "games.account.manage" : "games.playnite.connect")}</span></button>
    {open && active && <PlayniteDialog playnite={playnite} onClose={close}/>}
  </div>;
}

function PlayniteDialog({ playnite, onClose }: { playnite: PlayniteLibrary; onClose: () => void }) {
  const t = useT(), language = useUiLanguage(), id = useId(), root = useAccountDialogFocus(), { closing, close } = useModalExit(onClose);
  useSectionBack(close, true);
  const { status } = playnite;
  const installed = status.games.filter(game => game.installed).length;
  const step = !status.found ? "missing" : status.extension !== "installed" ? "extension" : status.exportedAt ? "ready" : "waiting";
  return <ModalShell width={560} closing={closing} onDismiss={close} labelledBy={id} backdropClassName="games-account-backdrop"><div ref={root} className="games-account-dialog games-playnite-dialog">
    <header><LibrarySourceMark source="playnite" size={34}/><div><h2 id={id}>Playnite</h2></div><button className="games-icon-button" aria-label={t("common.close")} onClick={close}><X size={22}/></button></header>
    <div className="games-account-dialog-scroll">
      <p className="games-account-intro">{t("games.playnite.intro")}</p>
      {step === "missing" && <p className="games-playnite-status" role="status">{t("games.playnite.notFound")}</p>}
      {step === "extension" && <p className="games-playnite-status" role="status">{t(status.extension === "outdated" ? "games.playnite.outdated" : "games.playnite.installNote")}</p>}
      {step === "waiting" && <p className="games-playnite-status" role="status">{t("games.playnite.restart")}</p>}
      {step === "ready" && <p className="games-playnite-status" role="status">{t("games.playnite.summary", { count: status.games.length.toLocaleString(language), installed: installed.toLocaleString(language), date: new Date(status.exportedAt).toLocaleString(language) })}</p>}
      {status.found && status.dataDir && <p className="games-playnite-folder"><span>{t("games.playnite.folder")}</span><code dir="ltr" title={status.dataDir}>{status.dataDir}</code></p>}
      {status.error === "playnite_export_invalid" && <p className="games-playnite-status" role="alert">{t("games.playnite.playnite_export_invalid")}</p>}
      {playnite.error && <div className="games-account-error" role="alert"><span>{t(playnite.error)}</span><button className="games-text-action" onClick={playnite.dismissError}>{t("common.close")}</button></div>}
      <p className="games-playnite-note">{t("games.playnite.privacy")}</p>
    </div>
    <footer>
      <button className="games-button" disabled={playnite.busy} onClick={() => void playnite.chooseFolder(t("games.playnite.chooseFolder"))}><FolderOpen size={16}/>{t("games.playnite.chooseFolder")}</button>
      {playnite.folder && <button className="games-text-action" disabled={playnite.busy} onClick={playnite.forgetFolder}>{t("games.playnite.useDefault")}</button>}
      {step === "extension" && <button className="games-button games-button-primary" disabled={playnite.busy} onClick={() => void playnite.install()}>{t(status.extension === "outdated" ? "games.playnite.update" : "games.playnite.install")}</button>}
      {status.found && <button className="games-button" disabled={playnite.busy} onClick={() => void playnite.refresh()}><RefreshCw size={16}/>{t("games.unified.refresh")}</button>}
    </footer>
  </div></ModalShell>;
}
