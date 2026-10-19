// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  GATED_MUSIC_SOURCES,
  acceptMusicSources,
  filterMusicSourceCandidates,
  hasUsableMusicSource,
  musicPlaybackSourceAllowed,
  musicSourceAllowed,
  parseMusicSourceConsent,
  setMusicSourceEnabled,
  withdrawMusicSourceConsent,
} from "../src/lib/music/source-consent.ts";
import type { MusicConnection, MusicSourceCandidate } from "../src/lib/music/types.ts";

function connection(overrides: Partial<MusicConnection> = {}): MusicConnection {
  return {
    id: "local",
    name: "Local files",
    kind: "local",
    status: "connected",
    capabilities: ["play"],
    needs: [],
    ...overrides,
  };
}

function candidate(connectorId: string): MusicSourceCandidate {
  return {
    connectorId,
    connectorName: connectorId,
    health: "healthy",
    track: {
      id: `${connectorId}:track:1`,
      connectorId,
      title: "Song",
      artist: "Artist",
      artwork: "",
      durationSeconds: 180,
      durationLabel: "3:00",
    },
  };
}

test("Spotify is gated and stays off for consent saved before it was added", () => {
  assert.ok(GATED_MUSIC_SOURCES.includes("spotify"));
  const legacy = parseMusicSourceConsent(
    JSON.stringify({
      version: 1,
      acceptedAt: "2026-01-01T00:00:00.000Z",
      sources: { youtube: true, soundcloud: false },
    }),
  );
  assert.equal(legacy.sources.youtube, true);
  assert.equal(legacy.sources.spotify, false);
});

test("accepting Spotify allows only it, and disabling it revokes it", () => {
  withdrawMusicSourceConsent();
  assert.equal(musicSourceAllowed("spotify"), false);
  acceptMusicSources(["spotify"]);
  assert.equal(musicSourceAllowed("spotify"), true);
  assert.equal(musicSourceAllowed("youtube"), false);
  setMusicSourceEnabled("spotify", false);
  assert.equal(musicSourceAllowed("spotify"), false);
});

test("only playable sources unlock the music home", () => {
  withdrawMusicSourceConsent();
  assert.equal(hasUsableMusicSource([]), false);
  assert.equal(
    hasUsableMusicSource([
      connection({ id: "catalog", kind: "catalog", anonymous: true, capabilities: ["browse"] }),
    ]),
    false,
  );
  assert.equal(
    hasUsableMusicSource([
      connection({ id: "lastfm", kind: "scrobbler", capabilities: ["scrobble"] }),
    ]),
    false,
  );
  assert.equal(hasUsableMusicSource([connection()]), true);
});

test("a configured source still unlocks the music home while it reports an error", () => {
  assert.equal(hasUsableMusicSource([connection({ status: "disconnected" })]), false);
  assert.equal(hasUsableMusicSource([connection({ status: "error" })]), true);
});

test("anonymous streaming sources need their terms accepted", () => {
  withdrawMusicSourceConsent();
  const youtube = connection({
    id: "youtube",
    name: "YouTube Music",
    kind: "streaming",
    anonymous: true,
  });
  assert.equal(hasUsableMusicSource([youtube]), false);
  assert.equal(musicSourceAllowed("youtube_music"), false);
  acceptMusicSources(["youtube"]);
  assert.equal(hasUsableMusicSource([youtube]), true);
  assert.equal(musicSourceAllowed("youtube_music"), true);
  withdrawMusicSourceConsent();
  assert.equal(musicSourceAllowed("youtube_music"), false);
});

test("playback candidates skip gated sources that are turned off", () => {
  withdrawMusicSourceConsent();
  const candidates = [
    candidate("youtube"),
    candidate("youtube_music"),
    candidate("soundcloud"),
    candidate("local"),
  ];
  assert.deepEqual(
    filterMusicSourceCandidates(candidates).map((entry) => entry.connectorId),
    ["local"],
  );
  acceptMusicSources(["youtube"]);
  assert.deepEqual(
    filterMusicSourceCandidates(candidates).map((entry) => entry.connectorId),
    ["youtube", "youtube_music", "local"],
  );
  withdrawMusicSourceConsent();
});

test("a provider-less track follows the backend's YouTube fallback", () => {
  withdrawMusicSourceConsent();
  assert.equal(
    musicPlaybackSourceAllowed({ connectorId: undefined, playbackUrl: undefined }),
    false,
  );
  assert.equal(
    musicPlaybackSourceAllowed({ connectorId: undefined, playbackUrl: "https://example.test/a.mp3" }),
    true,
  );
  acceptMusicSources(["youtube"]);
  assert.equal(
    musicPlaybackSourceAllowed({ connectorId: undefined, playbackUrl: undefined }),
    true,
  );
  withdrawMusicSourceConsent();
});
