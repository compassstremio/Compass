import { readSharedSecret, subscribeSecretsReady, writeSharedSecret } from "@/lib/secret-store";
import { clearPendingWatches } from "./pending-sync";
import type { BingersAccess, BingersSession } from "./types";

const BASE_KEY = "compass.bingers.session.v1";

const subscribers = new Set<() => void>();
let cached: BingersSession | null = null;
let loaded = false;
// What the API last said about this account. Not persisted: a plan bought later should
// show up on the next run without the user doing anything.
let access: BingersAccess = "unknown";

function isSession(value: unknown): value is BingersSession {
  const s = value as Partial<BingersSession> | null;
  return (
    !!s &&
    typeof s.accessToken === "string" &&
    s.accessToken.length > 0 &&
    (s.refreshToken === null || typeof s.refreshToken === "string") &&
    typeof s.expiresAt === "number" &&
    typeof s.connectedAt === "number"
  );
}

function read(): BingersSession | null {
  try {
    const raw = readSharedSecret(BASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSession(parsed)) return null;
    return {
      ...parsed,
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      name: typeof parsed.name === "string" ? parsed.name : null,
      handle: typeof parsed.handle === "string" ? parsed.handle : null,
    };
  } catch {
    return null;
  }
}

function write(session: BingersSession | null): void {
  try {
    writeSharedSecret(BASE_KEY, session ? JSON.stringify(session) : null);
  } catch {
    return;
  }
}

function notify(): void {
  for (const fn of subscribers) fn();
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  cached = read();
}

export function resetForProfile(): void {
  loaded = false;
  cached = null;
  notify();
}

// A reader that mounted before the persisted store landed cached a null session.
if (typeof window !== "undefined") subscribeSecretsReady(resetForProfile);

export function getSession(): BingersSession | null {
  ensureLoaded();
  return cached;
}

export function setSession(session: BingersSession | null): void {
  ensureLoaded();
  const sameAccount = !!session && !!cached && session.connectedAt === cached.connectedAt;
  // Watches queued for one account must never replay into another.
  if (!sameAccount) {
    clearPendingWatches();
    access = "unknown";
  }
  cached = session;
  write(session);
  notify();
}

export function subscribeSession(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function getAccess(): BingersAccess {
  return access;
}

export function setAccess(next: BingersAccess): void {
  if (next === access) return;
  access = next;
  notify();
}
