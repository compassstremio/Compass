import assert from "node:assert/strict";
import test from "node:test";
import { dockActivated } from "../src/lib/music/dock-activation";

test("a restored, paused track does not open the dock on launch", () => {
  assert.equal(dockActivated(false, "paused"), false);
  assert.equal(dockActivated(false, "idle"), false);
});

test("starting playback opens the dock", () => {
  assert.equal(dockActivated(false, "resolving"), true);
  assert.equal(dockActivated(false, "playing"), true);
});

test("the dock stays open for the session after the listener pauses", () => {
  assert.equal(dockActivated(true, "paused"), true);
  assert.equal(dockActivated(true, "idle"), true);
});
