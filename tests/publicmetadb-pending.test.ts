// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import "./_localstorage-stub.ts";
import {
  clearPendingResumes,
  flushPendingResumes,
  listPendingResumes,
  pendingResumeKey,
  recordPendingResume,
  removePendingResume,
  syncPendingResume,
} from "../src/lib/publicmetadb/pending-sync.ts";
import type { PmdbTarget } from "../src/lib/publicmetadb/types.ts";

const MOVIE: PmdbTarget = { tmdb_id: 550, media_type: "movie" };
const EPISODE: PmdbTarget = { tmdb_id: 1399, media_type: "tv", season: 1, episode: 2 };

function online(saveImpl: (target: PmdbTarget) => Promise<boolean> = async () => true) {
  const calls: Array<{ target: PmdbTarget; positionMs: number; runtimeMs: number }> = [];
  return {
    calls,
    deps: {
      hasSession: () => true,
      save: async (target: PmdbTarget, positionMs: number, runtimeMs: number) => {
        calls.push({ target, positionMs, runtimeMs });
        return saveImpl(target);
      },
    },
  };
}

test("record stores a resume entry keyed by target", () => {
  localStorage.clear();
  const key = recordPendingResume(MOVIE, 60_000, 600_000);
  assert.equal(key, pendingResumeKey(MOVIE));
  const items = listPendingResumes();
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].target, MOVIE);
  assert.equal(items[0].positionMs, 60_000);
});

test("record replaces the same key and newest write wins", () => {
  localStorage.clear();
  recordPendingResume(EPISODE, 10_000, 100_000, 1000);
  recordPendingResume(EPISODE, 20_000, 100_000, 2000);
  // A stale retry must not clobber fresher progress.
  recordPendingResume(EPISODE, 5_000, 100_000, 1500);
  const items = listPendingResumes();
  assert.equal(items.length, 1);
  assert.equal(items[0].positionMs, 20_000);
});

test("record rejects invalid payloads", () => {
  localStorage.clear();
  assert.equal(recordPendingResume({ media_type: "tv" } as PmdbTarget, 1, 0), null);
  assert.equal(recordPendingResume(MOVIE, Number.NaN, 600_000), null);
  assert.equal(listPendingResumes().length, 0);
});

test("flush replays entries and drops them on success", async () => {
  localStorage.clear();
  recordPendingResume(MOVIE, 60_000, 600_000);
  recordPendingResume(EPISODE, 30_000, 300_000);
  const f = online();
  const out = await flushPendingResumes(f.deps);
  assert.equal(out.flushed, 2);
  assert.equal(out.remaining, 0);
  assert.equal(f.calls.length, 2);
  assert.equal(listPendingResumes().length, 0);
});

test("flush keeps the entry and stops on first failure", async () => {
  localStorage.clear();
  recordPendingResume(MOVIE, 60_000, 600_000);
  recordPendingResume(EPISODE, 30_000, 300_000);
  const f = online(async () => false);
  const out = await flushPendingResumes(f.deps);
  assert.equal(out.flushed, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(out.remaining, 2);
});

test("flush drops expired entries without network", async () => {
  localStorage.clear();
  recordPendingResume(MOVIE, 60_000, 600_000, Date.now() - 8 * 24 * 60 * 60 * 1000);
  const f = online();
  const out = await flushPendingResumes(f.deps);
  assert.equal(f.calls.length, 0);
  assert.equal(out.remaining, 0);
});

test("flush does nothing without a session", async () => {
  localStorage.clear();
  recordPendingResume(MOVIE, 60_000, 600_000);
  const out = await flushPendingResumes({ hasSession: () => false, save: async () => true });
  assert.equal(out.flushed, 0);
  assert.equal(out.remaining, 1);
});

test("remove and clear drop entries", () => {
  localStorage.clear();
  const key = recordPendingResume(MOVIE, 60_000, 600_000);
  assert.ok(key);
  removePendingResume(key!);
  assert.equal(listPendingResumes().length, 0);
  recordPendingResume(MOVIE, 60_000, 600_000);
  clearPendingResumes();
  assert.equal(listPendingResumes().length, 0);
});

test("an older flush acknowledgement preserves a newer snapshot for the same title", async () => {
  localStorage.clear();
  const at = Date.now();
  recordPendingResume(MOVIE, 60_000, 600_000, at);
  let finish!: (ok: boolean) => void;
  const running = flushPendingResumes({ hasSession: () => true, save: () => new Promise((resolve) => { finish = resolve; }) });
  // Same-millisecond writes still represent distinct progress snapshots.
  recordPendingResume(MOVIE, 120_000, 600_000, at);
  finish(true);
  await running;
  assert.equal(listPendingResumes()[0].positionMs, 120_000);
});

for (const succeeds of [true, false]) {
  test(`an older live save cannot remove or replace a newer snapshot (success=${succeeds})`, async () => {
    localStorage.clear();
    let finish!: (ok: boolean) => void;
    const running = syncPendingResume(MOVIE, 60_000, 600_000, () => new Promise((resolve) => { finish = resolve; }));
    assert.equal(listPendingResumes()[0].positionMs, 60_000);
    recordPendingResume(MOVIE, 120_000, 600_000);
    finish(succeeds);
    await running;
    assert.equal(listPendingResumes()[0].positionMs, 120_000);
  });
}

test("a rejected live save keeps its durable snapshot", async () => {
  localStorage.clear();
  assert.equal(await syncPendingResume(MOVIE, 60_000, 600_000, async () => { throw new Error("offline"); }), false);
  assert.equal(listPendingResumes()[0].positionMs, 60_000);
});

test("a live acknowledgement cannot clear entries created after disconnect", async () => {
  localStorage.clear();
  let finish!: (ok: boolean) => void;
  const running = syncPendingResume(MOVIE, 60_000, 600_000, () => new Promise((resolve) => { finish = resolve; }));
  clearPendingResumes();
  recordPendingResume(MOVIE, 120_000, 600_000);
  finish(true);
  await running;
  assert.equal(listPendingResumes()[0].positionMs, 120_000);
});

test("flush skips snapshots superseded while another title was being sent", async () => {
  localStorage.clear();
  recordPendingResume(MOVIE, 60_000, 600_000);
  recordPendingResume(EPISODE, 30_000, 300_000);
  let finish!: (ok: boolean) => void;
  let sends = 0;
  const running = flushPendingResumes({ hasSession: () => true, save: () => { sends++; return new Promise((resolve) => { finish = resolve; }); } });
  recordPendingResume(MOVIE, 120_000, 600_000);
  finish(true);
  await running;
  assert.equal(sends, 1);
  assert.equal(listPendingResumes()[0].positionMs, 120_000);
});
