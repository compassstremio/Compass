import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { HoverTooltip } from "@/components/hover-tooltip";
import { useT } from "@/lib/i18n";

/** Steam asks for its own confirmation; Compass only opens Steam's uninstall dialog for the observed app. */
export function GameSteamUninstallButton({ appId, name }: { appId: number; name: string }) {
  const t = useT(), [opening, setOpening] = useState(false), [failed, setFailed] = useState(false);
  const label = t(failed ? "games.steamUninstall.failed" : "games.steamUninstall.label", { name });
  const run = async () => {
    setOpening(true); setFailed(false);
    try { await invoke("games_manage_steam", { appId, action: "uninstall" }); }
    catch { setFailed(true); }
    finally { setOpening(false); }
  };
  return <HoverTooltip label={label}><button className="games-detail-icon-action" aria-label={label} disabled={opening} onClick={() => void run()}><Trash2 size={27}/></button></HoverTooltip>;
}
