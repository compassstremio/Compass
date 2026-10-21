import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.ts";
import { resolveBingersTarget } from "../src/lib/bingers/ids.ts";
import type { BingersTarget } from "../src/lib/bingers/types.ts";

type Src = {
  meta: { id: string; type: string };
  episode?: { season: number; episode: number };
  imdbId?: string;
};

function fixture({ connected = true, enabled = true } = {}) {
  let position = 0;
  const sent: BingersTarget[] = [];
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let timerId = 0;
  const harness = hookHarness(
    "src/lib/bingers/scrobble-hook.ts",
    "useBingersScrobble",
    {
      "@/lib/player/playback-clock": { getPlaybackPosition: () => position },
      "@/lib/settings": { useSettings: () => ({ settings: { bingersScrobbleEnabled: enabled } }) },
      "./ids": { resolveBingersTarget },
      "./provider": {
        useBingers: () => ({
          isConnected: connected,
          recordWatch: async (target: BingersTarget) => {
            sent.push(target);
          },
        }),
      },
    },
    {
      window: {
        setInterval: (callback: () => void) => {
          const id = ++timerId;
          intervals.set(id, callback);
          return id;
        },
        clearInterval: (id: number) => intervals.delete(id),
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    },
  );
  return {
    sent,
    render(src: Src, status = "playing", durationSec = 1000) {
      harness.render({ src, snap: { status, durationSec, positionSec: position } });
    },
    /** Moves the clock without the periodic check seeing it. */
    seek(seconds: number) {
      position = seconds;
    },
    /** Moves the clock and lets the periodic check run. */
    at(seconds: number) {
      position = seconds;
      for (const callback of [...intervals.values()]) callback();
    },
    pageHide: () => listeners.get("pagehide")?.(),
    unmount: () => harness.unmount(),
  };
}

const movie: Src = { meta: { id: "tt1375666", type: "movie" } };
const episode = (n: number): Src => ({
  meta: { id: "tt0903747", type: "series" },
  episode: { season: 1, episode: n },
});

test("a movie is sent once, after 90% of it has played", () => {
  const f = fixture();
  f.render(movie);
  f.at(500);
  f.at(899);
  assert.deepEqual(f.sent, []);
  f.at(905);
  f.at(990);
  assert.deepEqual(f.sent, [{ title: "imdb:tt1375666" }]);
  f.render(movie, "paused");
  f.pageHide();
  f.unmount();
  assert.equal(f.sent.length, 1);
});

test("leaving the player past 90% counts even before the next check", () => {
  const f = fixture();
  f.render(movie);
  f.seek(950);
  f.unmount();
  assert.deepEqual(f.sent, [{ title: "imdb:tt1375666" }]);
});

test("leaving before 90% sends nothing", () => {
  const f = fixture();
  f.render(movie);
  f.at(600);
  f.unmount();
  assert.deepEqual(f.sent, []);
});

test("pausing past 90% settles the watch at once", () => {
  const f = fixture();
  f.render(movie);
  f.seek(920);
  assert.deepEqual(f.sent, []);
  f.render(movie, "paused");
  assert.deepEqual(f.sent, [{ title: "imdb:tt1375666" }]);
});

test("closing the app past 90% records the watch from pagehide", () => {
  const f = fixture();
  f.render(movie);
  f.seek(960);
  f.pageHide();
  assert.deepEqual(f.sent, [{ title: "imdb:tt1375666" }]);
});

test("moving to the next episode sends the finished one under its own identity", () => {
  const f = fixture();
  f.render(episode(1));
  f.at(940);
  assert.deepEqual(f.sent, [{ title: "imdb:tt0903747", season: 1, episode: 1 }]);
  f.render(episode(2));
  assert.equal(f.sent.length, 1, "the finished episode is not sent twice on the switch");
  f.at(100);
  assert.equal(f.sent.length, 1);
  f.at(960);
  assert.deepEqual(f.sent[1], { title: "imdb:tt0903747", season: 1, episode: 2 });
});

test("a series with no episode, a short clip, a disabled toggle or no account sends nothing", () => {
  const show = fixture();
  show.render({ meta: { id: "tt0903747", type: "series" } });
  show.at(990);
  show.unmount();
  assert.deepEqual(show.sent, []);

  const clip = fixture();
  clip.render(movie, "playing", 90);
  clip.at(89);
  clip.unmount();
  assert.deepEqual(clip.sent, []);

  const off = fixture({ enabled: false });
  off.render(movie);
  off.at(990);
  off.unmount();
  assert.deepEqual(off.sent, []);

  const signedOut = fixture({ connected: false });
  signedOut.render(movie);
  signedOut.at(990);
  signedOut.pageHide();
  signedOut.unmount();
  assert.deepEqual(signedOut.sent, []);
});
