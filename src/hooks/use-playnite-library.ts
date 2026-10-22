import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { osClass } from "@/lib/platform";
import { emptyPlayniteStatus, PLAYNITE_FOLDER_KEY, type PlayniteStatus } from "@/lib/games/playnite";

const readFolder = () => { try { return localStorage.getItem(PLAYNITE_FOLDER_KEY) || null; } catch { return null; } };
const writeFolder = (value: string | null) => { try { if (value) localStorage.setItem(PLAYNITE_FOLDER_KEY, value); else localStorage.removeItem(PLAYNITE_FOLDER_KEY); } catch { /* The folder is a convenience; detection still runs. */ } };
const errorKey = (error: unknown) => {
  const code = typeof error === "string" ? error : "";
  return code.startsWith("playnite_") ? `games.playnite.${code}` : "games.playnite.playnite_launch_failed";
};

export function usePlayniteLibrary(active: boolean) {
  const available = isTauri() && osClass() === "windows";
  const [status, setStatus] = useState<PlayniteStatus>(emptyPlayniteStatus);
  const [folder, setFolder] = useState(readFolder), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [launching, setLaunching] = useState<string | null>(null), [error, setError] = useState("");
  const live = useRef(true), revision = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refresh = useCallback(async (from = folder) => {
    if (!available) return;
    const current = ++revision.current;
    try {
      const next = await invoke<PlayniteStatus>("games_playnite_status", { folder: from });
      if (live.current && current === revision.current) { setStatus(next); setLoaded(true); }
    } catch (error) { if (live.current) setError(errorKey(error)); }
  }, [available, folder]);
  useEffect(() => { if (!active) return; void refresh(); const focus = () => void refresh(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [active, refresh]);
  const install = async () => {
    if (!available || busy) return false; setBusy(true); setError("");
    try { const next = await invoke<PlayniteStatus>("games_playnite_install", { folder }); if (live.current) setStatus(next); return true; }
    catch (error) { if (live.current) setError(errorKey(error)); return false; }
    finally { if (live.current) setBusy(false); }
  };
  const chooseFolder = async (title: string) => {
    if (!available || busy) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title });
      if (typeof picked !== "string" || !live.current) return;
      const next = await invoke<PlayniteStatus>("games_playnite_status", { folder: picked });
      if (!live.current) return;
      if (!next.found) { setError("games.playnite.playnite_missing"); return; }
      writeFolder(picked); setFolder(picked); setStatus(next); setError("");
    } catch (error) { if (live.current) setError(errorKey(error)); }
  };
  const forgetFolder = () => { writeFolder(null); setFolder(null); void refresh(null); };
  /** "start" plays an installed copy; "show" opens the entry so Playnite can install it. */
  const open = async (id: string, action: "start" | "show") => {
    if (!available || launching) return; setLaunching(id); setError("");
    try { await invoke("games_playnite_open", { folder, id, action }); }
    catch (error) { if (live.current) setError(errorKey(error)); }
    finally { if (live.current) setLaunching(null); }
  };
  return { available, status, loaded, folder, busy, launching, error, refresh, install, chooseFolder, forgetFolder, open, dismissError: () => setError("") };
}
export type PlayniteLibrary = ReturnType<typeof usePlayniteLibrary>;
