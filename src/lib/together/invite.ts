import { ROOM_CODE_LENGTH } from "./protocol";
import { COMPASS_RELAY_BASE } from "@/lib/config/endpoints";
import { migratePublicRelayUrl } from "./relay-version";

const RELAY_PARAM = "compass-relay";
const ROOM_PARAM = "compass-room";

export type ParsedInvite = {
  relayUrl: string;
  roomCode: string;
};

export const WEB_JOIN_BASE = COMPASS_RELAY_BASE;

// Native launch URLs can arrive before the Together provider has mounted.
let pendingInvite: ParsedInvite | null = null;
const inviteListeners = new Set<(invite: ParsedInvite) => void>();

export function emitTogetherInvite(invite: ParsedInvite): void {
  if (inviteListeners.size === 0) pendingInvite = invite;
  else inviteListeners.forEach((listener) => listener(invite));
}

export function onTogetherInvite(listener: (invite: ParsedInvite) => void): () => void {
  inviteListeners.add(listener);
  const invite = pendingInvite;
  pendingInvite = null;
  if (invite) listener(invite);
  return () => {
    inviteListeners.delete(listener);
  };
}

function parseInviteParams(params: URLSearchParams): ParsedInvite | null {
  if (params.getAll(RELAY_PARAM).length !== 1 || params.getAll(ROOM_PARAM).length !== 1) return null;
  const relay = migratePublicRelayUrl(params.get(RELAY_PARAM)?.trim() ?? "");
  const roomRaw = params.get(ROOM_PARAM)?.trim();
  if (!relay || !roomRaw) return null;
  const room = roomRaw.toUpperCase();
  if (room.length !== ROOM_CODE_LENGTH || /[^A-Z0-9]/.test(room)) return null;
  try {
    const url = new URL(relay);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      !url.hostname || url.username || url.password || url.hash
    ) return null;
  } catch {
    return null;
  }
  return { relayUrl: relay, roomCode: room };
}

export function parseTogetherDeepLink(input: string): ParsedInvite | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "compass:" || url.hostname !== "together" ||
      (url.pathname && url.pathname !== "/")
    ) return null;
    if (url.username || url.password || url.port || url.hash) return null;
    return parseInviteParams(url.searchParams);
  } catch {
    return null;
  }
}

export function buildInviteUrl(relayUrl: string, roomCode: string, origin?: string): string {
  const local =
    typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)
      ? window.location.origin
      : WEB_JOIN_BASE;
  const base = origin ?? local;
  const params = new URLSearchParams();
  params.set(RELAY_PARAM, relayUrl);
  params.set(ROOM_PARAM, roomCode.toUpperCase());
  return `${base}/?${params.toString()}`;
}

export function parseInviteFromLocation(): ParsedInvite | null {
  if (typeof window === "undefined") return null;
  return parseInviteParams(new URLSearchParams(window.location.search));
}

export function clearInviteParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete(RELAY_PARAM);
  url.searchParams.delete(ROOM_PARAM);
  window.history.replaceState(null, "", url.toString());
}
