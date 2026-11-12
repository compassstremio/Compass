import * as sourceVersion from "../../src/lib/music/source-version.ts";
import * as queueAutomation from "../../src/lib/music/queue-automation.ts";
import * as queueSource from "../../src/lib/music/queue-source.ts";
import * as explicitPreference from "../../src/lib/music/explicit-preference.ts";

/**
 * Dependencies of src/lib/music/player.ts that the player harnesses do not exercise.
 *
 * Pure modules are the real ones. Stores that read local storage or the native engine are inert:
 * nothing hydrates, nothing is blocked, no engine is playing, and the queue advances in order.
 * A harness that needs one of them to behave differently overrides it after spreading this in.
 */
export function musicPlayerDependencies(): Record<string, any> {
  const noop = () => {};
  const resolved = async () => {};
  return {
    "./source-version": sourceVersion,
    "./queue-automation": queueAutomation,
    "./queue-source": queueSource,
    "./explicit-preference": explicitPreference,
    "@/lib/active-profile-id": { activeProfileId: () => "primary", activeProfileIsPrimary: () => true },
    "@/lib/platform": { isWindowsDesktop: () => false },
    "./listening-affinity": { hydrateListeningAffinity: resolved, observeMusicListening: noop },
    "./artist-blocks": {
      filterBlockedTracks: (tracks: unknown[]) => tracks,
      hydrateArtistBlockStore: resolved,
    },
    "./liked-artists": { hydrateLikedArtistStore: resolved },
    "./decks": { engineSnapshot: async () => null },
    "./pinned-sources": {
      loadPinnedSources: resolved,
      peekPinnedSource: () => null,
      pinSourceFor: noop,
      unpinSourceFor: noop,
    },
    "./transport": {
      musicAdvance: (queue: unknown[], index: number) => queue[index + 1] ?? null,
      musicPrevious: (queue: unknown[], index: number) => queue[index - 1] ?? null,
      musicWarmTargets: (queue: unknown[], index: number, count: number) =>
        queue.slice(index + 1, index + 1 + count),
      resetMusicOrder: noop,
    },
    "./recent-context": {
      hydrateMusicContextTracks: resolved,
      hydrateMusicRecentContexts: resolved,
    },
    "./recent-destinations": { hydrateMusicDestinations: resolved },
    "./pinned-playlists": { hydratePinnedMusicPlaylists: resolved },
  };
}
