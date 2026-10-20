import assert from "node:assert/strict";
import test from "node:test";
import "./_localstorage-stub.ts";
import {
  clearPendingWatches,
  listPendingWatches,
  pendingGeneration,
  recordPendingWatch,
  removePendingWatches,
  targetKey,
} from "../src/lib/bingers/pending-sync.ts";
import {
  accessForError,
  outcomeForStatus,
  outcomesFor,
  scrobbleItem,
} from "../src/lib/bingers/scrobble-body.ts";

const episode = { title: "imdb:tt0903747", season: 1, episode: 2 };
const movie = { title: "imdb:tt1375666" };

test("a scrobble item carries the time it was watched", () => {
  assert.deepEqual(scrobbleItem(episode, "2026-10-20T21:00:00.000Z"), {
    ...episode,
    watched_at: "2026-10-20T21:00:00.000Z",
  });
});

test("results map onto the items by index; repeats count as recorded", () => {
  const data = {
    results: [
      { index: 1, status: "unresolved" },
      { index: 0, status: "already" },
      { index: 2, status: "error" },
      { index: 3, status: "ok", outcome: "watched" },
    ],
  };
  assert.deepEqual(outcomesFor(data, 4), ["recorded", "unresolved", "failed", "recorded"]);
  assert.deepEqual(outcomesFor({}, 2), ["recorded", "recorded"]);
  assert.deepEqual(outcomesFor({ results: [{ index: 9, status: "error" }] }, 1), ["recorded"]);
});

test("only transient failures are retried", () => {
  for (const status of [null, 401, 408, 429, 500, 503])
    assert.equal(outcomeForStatus(status), "failed");
  for (const status of [400, 403, 404, 422]) assert.equal(outcomeForStatus(status), "refused");
});

test("a 403 tells a missing plan apart from a missing write scope", () => {
  assert.equal(accessForError(403, "insufficient_scope"), "reauth");
  assert.equal(accessForError(403, "forbidden"), "plan-required");
  assert.equal(accessForError(403, null), "plan-required");
  assert.equal(accessForError(429, null), null);
});

test("the queue keeps one entry per item, newest first", () => {
  clearPendingWatches();
  recordPendingWatch(episode, "2026-10-20T20:00:00.000Z");
  recordPendingWatch(movie, "2026-10-20T20:30:00.000Z");
  recordPendingWatch(episode, "2026-10-20T21:00:00.000Z");
  const list = listPendingWatches();
  assert.deepEqual(
    list.map((p) => [p.key, p.watchedAt]),
    [
      [targetKey(episode), "2026-10-20T21:00:00.000Z"],
      [targetKey(movie), "2026-10-20T20:30:00.000Z"],
    ],
  );
  removePendingWatches(new Set([targetKey(episode)]));
  assert.deepEqual(
    listPendingWatches().map((p) => p.key),
    [targetKey(movie)],
  );
});

test("clearing drops every profile's queue and invalidates running flushes", () => {
  recordPendingWatch(movie, "2026-10-20T20:30:00.000Z");
  localStorage.setItem("compass.bingers.pending.v1.other-profile", JSON.stringify([]));
  const before = pendingGeneration();
  clearPendingWatches();
  assert.equal(pendingGeneration(), before + 1);
  assert.deepEqual(listPendingWatches(), []);
  assert.equal(localStorage.getItem("compass.bingers.pending.v1.other-profile"), null);
});

test("a corrupt queue reads as empty", () => {
  localStorage.setItem("compass.bingers.pending.v1.default", "{not json");
  assert.deepEqual(listPendingWatches(), []);
  localStorage.setItem("compass.bingers.pending.v1.default", JSON.stringify([{ key: 1 }, null]));
  assert.deepEqual(listPendingWatches(), []);
  clearPendingWatches();
});
