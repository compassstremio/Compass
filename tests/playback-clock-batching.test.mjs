import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness() {
  const timers = new Map();
  let nextId = 0;
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/player/playback-clock.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const api = {};
  new Function("require", "exports", "setTimeout", "clearTimeout", code)(
    () => ({}),
    api,
    (cb, ms) => {
      assert.equal(ms, 100);
      timers.set(++nextId, cb);
      return nextId;
    },
    (id) => timers.delete(id),
  );
  return {
    api,
    timers,
    flush() {
      const pending = [...timers.values()];
      timers.clear();
      for (const cb of pending) cb();
    },
  };
}

test("bursty telemetry notifies once with current position and buffer", () => {
  const h = harness();
  let notifications = 0;
  h.api.subscribePlaybackClock(() => notifications++);
  for (let i = 1; i <= 1000; i++) h.api.setPlaybackClock(i, i * 2);
  assert.equal(notifications, 0);
  assert.equal(h.timers.size, 1);
  assert.equal(h.api.getPlaybackPosition(), 1000);
  assert.equal(h.api.getPlaybackBuffered(), 2000);
  h.flush();
  assert.equal(notifications, 1);
  h.api.setPlaybackClock(1000, 2000);
  assert.equal(h.timers.size, 0);
  h.api.setPlaybackDownloaded(0.5);
  h.api.setPlaybackClock(1001, 2001);
  h.flush();
  assert.equal(notifications, 2);
  assert.equal(h.api.getPlaybackDownloaded(), 0.5);
});

test("unsubscribing cancels pending UI work, including between playback sessions", () => {
  const h = harness();
  let calls = 0;
  const off = h.api.subscribePlaybackClock(() => calls++);
  h.api.setPlaybackClock(10, 20);
  off();
  assert.equal(h.timers.size, 0);
  h.flush();
  assert.equal(calls, 0);
  h.api.setPlaybackClock(0, 0);
  assert.equal(h.timers.size, 0);
  h.api.subscribePlaybackClock(() => calls++);
  h.api.setPlaybackClock(1, 2);
  h.flush();
  assert.equal(calls, 1);
});
