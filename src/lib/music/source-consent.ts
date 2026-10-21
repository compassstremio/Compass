import { useSyncExternalStore } from "react";
import type { MusicConnection, MusicSourceCandidate, MusicTrack } from "./types";
import { hydrateJsonStore, readJsonStore, writeLocalJson } from "./local-store";

export const MUSIC_SOURCE_CONSENT_VERSION = 1;
export const MUSIC_SOURCE_CONSENT_KEY = "compass.music.source-consent.v1";
export const MUSIC_SOURCE_CONSENT_EVENT = "compass:music-source-consent";
const CONSENT_STORE = "source-consent";

export const GATED_MUSIC_SOURCES = ["youtube", "soundcloud", "spotify"] as const;
export type GatedMusicSource = (typeof GATED_MUSIC_SOURCES)[number];

export type MusicSourceConsent = Readonly<{
  version: number;
  acceptedAt: string | null;
  sources: Readonly<Record<GatedMusicSource, boolean>>;
}>;

const BLANK: MusicSourceConsent = Object.freeze({
  version: MUSIC_SOURCE_CONSENT_VERSION,
  acceptedAt: null,
  sources: Object.freeze({ youtube: false, soundcloud: false, spotify: false }),
});

function dated(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeConsent(value: unknown): MusicSourceConsent {
  try {
    if (!value || typeof value !== "object") return BLANK;
    const record = value as Record<string, unknown>;
    if (record.version !== MUSIC_SOURCE_CONSENT_VERSION || !dated(record.acceptedAt)) return BLANK;
    const stored = (record.sources ?? {}) as Record<string, unknown>;
    return Object.freeze({
      version: MUSIC_SOURCE_CONSENT_VERSION,
      acceptedAt: record.acceptedAt,
      sources: Object.freeze(
        Object.fromEntries(GATED_MUSIC_SOURCES.map((id) => [id, stored[id] === true])) as Record<
          GatedMusicSource,
          boolean
        >,
      ),
    });
  } catch {
    return BLANK;
  }
}

export function parseMusicSourceConsent(raw: string | null): MusicSourceConsent {
  try {
    return normalizeConsent(JSON.parse(raw ?? "null"));
  } catch {
    return BLANK;
  }
}

let consent = normalizeConsent(
  readJsonStore<unknown>(CONSENT_STORE, MUSIC_SOURCE_CONSENT_KEY, null),
);
const listeners = new Set<() => void>();

function publish(next: MusicSourceConsent): MusicSourceConsent {
  consent = next;
  writeLocalJson(CONSENT_STORE, next);
  for (const listener of listeners) listener();
  return consent;
}

/** Migrates the old browser-storage value once, then keeps consent in the JSON store. */
export async function hydrateMusicSourceConsent(): Promise<void> {
  await hydrateJsonStore(CONSENT_STORE, MUSIC_SOURCE_CONSENT_KEY);
  const next = normalizeConsent(
    readJsonStore<unknown>(CONSENT_STORE, MUSIC_SOURCE_CONSENT_KEY, null),
  );
  const same =
    next.acceptedAt === consent.acceptedAt &&
    GATED_MUSIC_SOURCES.every((id) => next.sources[id] === consent.sources[id]);
  if (same) return;
  consent = next;
  for (const listener of listeners) listener();
}

export const getMusicSourceConsent = () => consent;
export const getMusicSourceConsentServer = () => BLANK;
export function subscribeMusicSourceConsent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribing keeps a row honest: accepting must flip its label without a reload. */
export function useMusicSourceConsent(): MusicSourceConsent {
  return useSyncExternalStore(
    subscribeMusicSourceConsent,
    getMusicSourceConsent,
    getMusicSourceConsentServer,
  );
}

export function isGatedMusicSource(
  connectorId: string | null | undefined,
): connectorId is GatedMusicSource {
  return GATED_MUSIC_SOURCES.includes(connectorId as GatedMusicSource);
}

/** Legacy tracks spell the YouTube connector several ways; they all share one consent switch. */
function gatedSourceOf(connectorId: string | null | undefined): GatedMusicSource | null {
  const id = connectorId?.trim().toLowerCase();
  if (
    id === "youtube" ||
    id === "youtube_music" ||
    id === "youtubemusic" ||
    id === "youtube-music"
  )
    return "youtube";
  if (id === "soundcloud") return "soundcloud";
  if (id === "spotify") return "spotify";
  return null;
}

/** Ungated sources are the listener's own media or their own signed-in account; never blocked. */
export function musicSourceAllowed(connectorId: string | null | undefined): boolean {
  const source = gatedSourceOf(connectorId);
  if (!source) return true;
  return !!consent.acceptedAt && consent.sources[source];
}

/**
 * Configured sources keep the music home open even while they report an error, so a
 * temporary outage does not replace the listener's library with the first-run page.
 */
export function isMusicSourceUsable(connection: MusicConnection): boolean {
  const configured = connection.status === "connected" || connection.status === "error";
  return (
    configured &&
    connection.capabilities.includes("play") &&
    (!connection.anonymous || musicSourceAllowed(connection.id))
  );
}

export function hasUsableMusicSource(connections: readonly MusicConnection[]): boolean {
  return connections.some(isMusicSourceUsable);
}

/** Playback may only resolve through sources the listener has turned on. */
export function filterMusicSourceCandidates(
  candidates: readonly MusicSourceCandidate[],
): MusicSourceCandidate[] {
  return candidates.filter(
    (candidate) =>
      musicSourceAllowed(candidate.connectorId) &&
      musicSourceAllowed(candidate.track.connectorId),
  );
}

/** Mirrors the backend fallback: a track with no provider and no direct URL resolves via YouTube. */
export function musicPlaybackSourceAllowed(
  track: Pick<MusicTrack, "connectorId" | "playbackUrl">,
): boolean {
  const connectorId = track.connectorId ?? (track.playbackUrl ? "direct" : "youtube");
  return musicSourceAllowed(connectorId);
}

/** Runs the action now when the source is allowed, otherwise asks for consent and retries it after. */
export function guardMusicSource(id: GatedMusicSource, retry?: () => void): boolean {
  if (musicSourceAllowed(id)) return true;
  requestMusicSourceConsent(retry, id);
  return false;
}

export function acceptMusicSources(enabled: readonly GatedMusicSource[]): MusicSourceConsent {
  return publish(
    Object.freeze({
      version: MUSIC_SOURCE_CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
      sources: Object.freeze(
        Object.fromEntries(GATED_MUSIC_SOURCES.map((id) => [id, enabled.includes(id)])) as Record<
          GatedMusicSource,
          boolean
        >,
      ),
    }),
  );
}

export function setMusicSourceEnabled(id: GatedMusicSource, on: boolean): MusicSourceConsent {
  if (!consent.acceptedAt) return consent;
  return publish(
    Object.freeze({
      ...consent,
      sources: Object.freeze({ ...consent.sources, [id]: on }),
    }),
  );
}

export function withdrawMusicSourceConsent(): MusicSourceConsent {
  return publish(BLANK);
}

let pendingRetry: (() => void) | null = null;
let pendingFocus: GatedMusicSource | null = null;

/** What the listener was trying to do, so accepting completes it instead of asking twice. */
export function requestMusicSourceConsent(retry?: () => void, focus?: GatedMusicSource): void {
  pendingRetry = retry ?? null;
  pendingFocus = focus ?? null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MUSIC_SOURCE_CONSENT_EVENT));
}

export function peekMusicSourceConsentFocus(): GatedMusicSource | null {
  return pendingFocus;
}

export function takeMusicSourceConsentRetry(): (() => void) | null {
  const retry = pendingRetry;
  pendingRetry = null;
  pendingFocus = null;
  return retry;
}
