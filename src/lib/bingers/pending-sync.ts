import { activeProfileId } from "@/lib/active-profile-id";
import type { BingersTarget } from "./types";

const KEY = "compass.bingers.pending.v1";
const MAX = 50;

export type PendingWatch = {
  key: string;
  target: BingersTarget;
  /** ISO 8601; sent as `watched_at` so a late replay still lands on the right day. */
  watchedAt: string;
};

let generation = 0;

function storageKey(): string {
  return `${KEY}.${activeProfileId()}`;
}

export function targetKey(target: BingersTarget): string {
  return `${target.title ?? ""}|${target.season ?? ""}|${target.episode ?? ""}|${target.tvdb_episode ?? ""}`;
}

/** Bumped on every clear, so a flush that started before it never writes back. */
export function pendingGeneration(): number {
  return generation;
}

// The Bingers account is shared by every profile, so a disconnect or a different
// account drops every profile's queue, not just the active one.
export function clearPendingWatches(): void {
  generation += 1;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key === KEY || key?.startsWith(`${KEY}.`)) localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}

function isPending(value: unknown): value is PendingWatch {
  const p = value as Partial<PendingWatch> | null;
  return (
    !!p &&
    typeof p.key === "string" &&
    typeof p.watchedAt === "string" &&
    !!p.target &&
    typeof p.target === "object"
  );
}

export function listPendingWatches(): PendingWatch[] {
  try {
    const raw = localStorage.getItem(storageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

function save(list: PendingWatch[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(storageKey());
    else localStorage.setItem(storageKey(), JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function recordPendingWatch(target: BingersTarget, watchedAt: string): void {
  const next: PendingWatch = { key: targetKey(target), target, watchedAt };
  save([next, ...listPendingWatches().filter((p) => p.key !== next.key)]);
}

export function removePendingWatches(keys: ReadonlySet<string>): void {
  if (keys.size === 0) return;
  save(listPendingWatches().filter((p) => !keys.has(p.key)));
}
