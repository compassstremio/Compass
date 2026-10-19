import { activeProfileId } from "@/lib/active-profile-id";
import { getSecret, setSecret } from "@/lib/secret-store";
import type { MediaServerConnection, RefreshUnit } from "./types";
import { normalizeServerOrigin } from "./transport";
import { connectionQuality } from "./quality";

const KEY = "compass.media-server.connections.v1";
const TOKEN = "compass.media-server.token.v1";
const listeners = new Set<() => void>();

function all(): MediaServerConnection[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.map((connection) => {
      const migrated = { refreshInterval: "launch", ...connection } as MediaServerConnection;
      if (migrated.refreshEveryValue == null && migrated.refreshEveryDays != null) {
        migrated.refreshEveryValue = migrated.refreshEveryDays;
        migrated.refreshEveryUnit = "days";
      }
      return { ...migrated, preferredQuality: connectionQuality(migrated) };
    });
  } catch {
    return [];
  }
}
function write(value: MediaServerConnection[]) {
  localStorage.setItem(KEY, JSON.stringify(value));
  listeners.forEach((fn) => fn());
}
export function mediaServerConnections(profileId = activeProfileId()) {
  return all().filter((c) => c.profileId === profileId);
}
export function saveMediaServerConnection(connection: MediaServerConnection, token?: string) {
  const clean = { ...connection, origin: normalizeServerOrigin(connection.origin) };
  write([...all().filter((c) => c.id !== clean.id), clean]);
  if (token != null) setSecret(`${TOKEN}.${clean.profileId}.${clean.id}`, token);
}
export function updateMediaServerConnection(
  id: string,
  patch: Partial<Omit<MediaServerConnection, "id" | "profileId" | "provider">>,
  profileId = activeProfileId(),
) {
  const current = all().find(
    (connection) => connection.id === id && connection.profileId === profileId,
  );
  if (!current) return;
  saveMediaServerConnection({ ...current, ...patch });
}
export function removeMediaServerConnection(id: string, profileId = activeProfileId()) {
  write(all().filter((c) => c.id !== id || c.profileId !== profileId));
  setSecret(`${TOKEN}.${profileId}.${id}`, null);
}
export function mediaServerToken(connection: MediaServerConnection) {
  return getSecret(`${TOKEN}.${connection.profileId}.${connection.id}`);
}
export function subscribeMediaServerConnections(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const REFRESH_MS: Record<MediaServerConnection["refreshInterval"], number> = {
  launch: 0,
  daily: 86_400_000,
  "three-days": 259_200_000,
  weekly: 604_800_000,
  custom: 0,
  manual: Number.POSITIVE_INFINITY,
};

const REFRESH_UNIT_MS: Record<RefreshUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

export function mediaServerRefreshIntervalMs(
  connection: MediaServerConnection,
): number | null {
  if (!connection.enabled) return null;
  if (connection.refreshInterval === "manual" || connection.refreshInterval === "launch")
    return null;
  return connection.refreshInterval === "custom"
    ? Math.max(1, connection.refreshEveryValue ?? connection.refreshEveryDays ?? 1) *
        REFRESH_UNIT_MS[connection.refreshEveryUnit ?? "days"]
    : REFRESH_MS[connection.refreshInterval];
}

export function mediaServerSyncDue(connection: MediaServerConnection, now = Date.now()): boolean {
  if (!connection.enabled || connection.refreshInterval === "manual") return false;
  if (connection.refreshInterval === "launch") return true;
  const interval = mediaServerRefreshIntervalMs(connection);
  if (interval == null) return false;
  return connection.lastSyncAt == null || now - connection.lastSyncAt >= interval;
}
