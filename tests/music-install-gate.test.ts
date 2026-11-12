import assert from "node:assert/strict";
import test from "node:test";
import { musicInstalled, type InstallFeatures } from "@/lib/features/install";

// Music startup (database open, queue restore, taskbar buttons) only runs when the installer kept
// the Music feature. A missing or unreadable marker keeps every feature on, as the rest of the
// install-feature gating does.
const features = (music: boolean): InstallFeatures => ({
  plugins: true,
  games: true,
  music,
  ebook: true,
  manga: true,
});

test("music is installed when the marker keeps it", async () => {
  assert.equal(await musicInstalled(async () => features(true)), true);
});

test("music is not installed when the installer removed it", async () => {
  assert.equal(await musicInstalled(async () => features(false)), false);
});

test("an unreadable marker keeps music on", async () => {
  assert.equal(
    await musicInstalled(async () => {
      throw new Error("install_features unavailable");
    }),
    true,
  );
});
