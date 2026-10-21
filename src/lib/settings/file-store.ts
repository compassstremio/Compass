import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readSettingsFile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return (await invoke<string | null>("settings_read")) ?? null;
  } catch {
    return null;
  }
}

export async function writeSettingsFile(content: string): Promise<boolean> {
  if (!isTauri) return true;
  try {
    await invoke("settings_write", { content });
    return true;
  } catch {
    console.warn("[settings] could not write the settings file; localStorage still holds the changes");
    return false;
  }
}
