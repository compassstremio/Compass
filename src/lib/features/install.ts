import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export type InstallFeatureKey = "plugins" | "games" | "music" | "ebook" | "manga";
export type InstallFeatures = Record<InstallFeatureKey, boolean>;

const ALL_ON: InstallFeatures = {
  plugins: true,
  games: true,
  music: true,
  ebook: true,
  manga: true,
};

let snapshot: InstallFeatures = ALL_ON;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export async function readInstallFeatures(): Promise<InstallFeatures> {
  const value = await invoke<Partial<InstallFeatures>>("install_features");
  return { ...ALL_ON, ...value };
}

/** Whether Music startup should run. Fails open like the rest of the gating: no marker, no removal. */
export async function musicInstalled(
  read: () => Promise<InstallFeatures> = readInstallFeatures,
): Promise<boolean> {
  try {
    return (await read()).music;
  } catch {
    return true;
  }
}

export function getInstallFeatures(): InstallFeatures {
  ensureLoaded();
  return snapshot;
}

function publish(next: InstallFeatures) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/** One read per session. A missing marker (dev builds, NSIS installs, other platforms) keeps
 * every feature on, so gating only ever removes what the installer was told to remove. */
function ensureLoaded() {
  if (loading) return;
  loading = readInstallFeatures()
    .then(publish)
    .catch(() => {
      loading = null; // web preview or an older build: let the next mount try again
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallFeatures(): InstallFeatures {
  return useSyncExternalStore(subscribe, () => snapshot, () => ALL_ON);
}
