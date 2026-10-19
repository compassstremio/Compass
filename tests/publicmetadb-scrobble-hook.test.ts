import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness, flushPromises } from "./helpers/hook-harness.ts";
import "./_localstorage-stub.ts";
import { clearPendingResumes, listPendingResumes, recordPendingResume, syncPendingResume } from "../src/lib/publicmetadb/pending-sync.ts";
import type { PmdbTarget } from "../src/lib/publicmetadb/types.ts";

function fixture(
  mark: () => Promise<boolean> = async () => true,
  save: () => Promise<{ action: "saved" } | null> = async () => ({ action: "saved" }),
  resetClockOnCleanup = false,
) {
  clearPendingResumes();
  let now = 1_000_000;
  let position = 910;
  let marked = 0;
  let deleted = 0;
  let recorded = 0;
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const saves: Array<{ target: PmdbTarget; positionMs: number }> = [];
  let timerId = 0;
  const harness = hookHarness("src/lib/publicmetadb/scrobble-hook.ts", "usePublicMetaDbScrobble", {
    "@/lib/player/playback-clock": { getPlaybackPosition: () => position },
    "@/lib/settings": { useSettings: () => ({ settings: { publicmetadbScrobbleEnabled: true } }) },
    "./provider": { usePublicMetaDb: () => ({ isConnected: true }) },
    "./ids": { resolvePmdbTarget: async (id: string) => ({ tmdb_id: Number(id.split(":")[2]), media_type: "movie" }) },
    "./scrobble": {
      pmdbDeleteResumeForTarget: async () => { deleted++; return true; },
      pmdbSaveResume: (target: PmdbTarget, positionMs: number) => {
        saves.push({ target, positionMs });
        return save();
      },
    },
    "./history": { markPmdbWatched: () => { marked++; return mark(); } },
    "./pending-sync": {
      recordPendingResume: (...args: Parameters<typeof recordPendingResume>) => {
        recorded++;
        return recordPendingResume(...args);
      },
      syncPendingResume: (...args: Parameters<typeof syncPendingResume>) => {
        recorded++;
        return syncPendingResume(...args);
      },
    },
  }, {
    Date: { now: () => now },
    window: {
      setInterval: (callback: () => void) => { const id = ++timerId; intervals.set(id, callback); return id; },
      clearInterval: (id: number) => {
        intervals.delete(id);
        if (resetClockOnCleanup) position = 0;
      },
      setTimeout: (callback: () => void) => { const id = ++timerId; timeouts.set(id, callback); return id; },
      clearTimeout: (id: number) => timeouts.delete(id),
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    },
  });
  return {
    render(status = "playing", id = "tmdb:movie:550") {
      harness.render({ src: { meta: { id, type: "movie" } }, snap: { status, durationSec: 1000, positionSec: position } });
    },
    async tick(seconds = 1) {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        position++;
        for (const callback of intervals.values()) callback();
        await flushPromises();
      }
    },
    counts: () => ({ marked, deleted, recorded }),
    saves,
    setPosition: (next: number) => { position = next; },
    pageHide: () => listeners.get("pagehide")?.(),
    unmount: () => harness.unmount(),
  };
}

test("completed playback sends one watched write across ticks, pause, end and unmount", async () => {
  const h = fixture();
  h.render();
  await flushPromises();
  await h.tick(120);
  h.render("paused");
  h.render("ended");
  h.unmount();
  await flushPromises();
  assert.deepEqual(h.counts(), { marked: 1, deleted: 1, recorded: 1 });
});

test("completion stays single-flight while the watched write is pending", async () => {
  let finish!: (ok: boolean) => void;
  const h = fixture(() => new Promise((resolve) => { finish = resolve; }));
  h.render();
  await flushPromises();
  await h.tick(120);
  h.render("paused");
  assert.deepEqual(h.counts(), { marked: 1, deleted: 0, recorded: 1 });
  finish(true);
  await flushPromises();
  assert.equal(h.counts().deleted, 1);
  h.unmount();
});

test("failed completion preserves the outbox and retries no faster than once per minute", async () => {
  let attempts = 0;
  const h = fixture(async () => ++attempts > 1);
  h.render();
  await flushPromises();
  await h.tick();
  h.render("paused");
  h.render("playing");
  await h.tick(59);
  assert.deepEqual(h.counts(), { marked: 1, deleted: 0, recorded: 1 });
  await h.tick();
  assert.deepEqual(h.counts(), { marked: 2, deleted: 1, recorded: 2 });
  h.unmount();
});

test("a new media identity can complete after the previous title completed", async () => {
  const h = fixture();
  h.render();
  await flushPromises();
  await h.tick();
  h.render("playing", "tmdb:movie:551");
  await flushPromises();
  await h.tick();
  assert.deepEqual(h.counts(), { marked: 2, deleted: 2, recorded: 2 });
  h.unmount();
});

test("leaving the player online sends the final rewound position immediately", async () => {
  const h = fixture();
  h.setPosition(800);
  h.render();
  await flushPromises();
  h.setPosition(400);
  h.unmount();
  await flushPromises();
  assert.deepEqual(h.saves.map((s) => s.positionMs), [400_000]);
  assert.equal(h.counts().marked, 0);
  assert.equal(listPendingResumes().length, 0);
});

test("exit captures the position before passive player teardown clears the clock", async () => {
  const h = fixture(undefined, undefined, true);
  h.setPosition(800);
  h.render();
  await flushPromises();
  h.setPosition(400);
  h.unmount();
  await flushPromises();
  assert.deepEqual(h.saves.map((s) => s.positionMs), [400_000]);
});

test("page shutdown persists the rewound position without attempting a live save", async () => {
  const h = fixture();
  h.render();
  await flushPromises();
  h.setPosition(400);
  h.pageHide();
  h.unmount();
  await flushPromises();
  assert.equal(h.saves.length, 0);
  assert.equal(h.counts().marked, 0);
  assert.equal(listPendingResumes()[0].positionMs, 400_000);
});

test("a failed exit save remains in the outbox for replay", async () => {
  const h = fixture(undefined, async () => null);
  h.setPosition(400);
  h.render();
  await flushPromises();
  h.unmount();
  await flushPromises();
  assert.equal(h.saves.length, 1);
  assert.equal(listPendingResumes()[0].positionMs, 400_000);
});

test("natural end can complete when the playback clock resets to zero", async () => {
  const h = fixture();
  h.render();
  await flushPromises();
  h.setPosition(0);
  h.render("ended");
  await flushPromises();
  assert.equal(h.counts().marked, 1);
  h.unmount();
});

test("changing media uses the previous item's latest position after a backward seek", async () => {
  const h = fixture();
  h.setPosition(800);
  h.render();
  await flushPromises();
  h.setPosition(400);
  await h.tick();
  h.setPosition(0);
  h.render("playing", "tmdb:movie:551");
  await flushPromises();
  assert.deepEqual(h.saves.map((s) => [s.target.tmdb_id, s.positionMs]), [[550, 401_000]]);
  h.unmount();
});
