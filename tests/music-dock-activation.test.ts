import assert from "node:assert/strict";
import test from "node:test";
import { dockActivated } from "../src/lib/music/dock-activation";

test("a restored, paused track does not open the dock on launch", () => {
  assert.equal(dockActivated(false, "paused", "a", "a"), false);
  assert.equal(dockActivated(false, "idle", "a", "a"), false);
});

test("starting playback opens the dock", () => {
  assert.equal(dockActivated(false, "resolving", "a", "a"), true);
  assert.equal(dockActivated(false, "playing", "a", "a"), true);
});

test("the dock stays open for the session after the listener pauses", () => {
  assert.equal(dockActivated(true, "paused", "a", "a"), true);
  assert.equal(dockActivated(true, "idle", "a", "a"), true);
});

test("a different track than the restored one opens the dock even without a playing phase", () => {
  assert.equal(dockActivated(false, "paused", "a", "b"), true);
  assert.equal(dockActivated(false, "paused", null, "b"), false);
});

test("a playback error opens the dock so it can be seen", () => {
  assert.equal(dockActivated(false, "error", "a", "a"), true);
});
