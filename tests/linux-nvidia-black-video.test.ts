// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const nativeMpv = read("src-tauri/src/mpv.rs");
const autoRetry = read("src/views/player/hooks/use-auto-retry.ts");
const card = read("src/views/player/source-error-card.tsx");

test("embedded Linux playback on the NVIDIA driver decodes with copy-back hwdec", () => {
  const helper = nativeMpv.slice(
    nativeMpv.indexOf("fn set_linux_hwdec"),
    nativeMpv.indexOf("fn apply_pre_init"),
  );
  assert.match(helper, /\/proc\/driver\/nvidia\/version/);
  assert.match(helper, /"hwdec", "nvdec-copy,vaapi-copy"/);
  assert.match(helper, /"hwdec", "nvdec-copy"\)/);
  assert.match(helper, /"hwdec", "auto-safe"/);
  assert.match(nativeMpv, /cfg!\(target_os = "linux"\) \{\s*set_linux_hwdec\(init, args\.embed/);
});

test("a source that plays without a picture is not reported as unresponsive", () => {
  assert.match(autoRetry, /"audio plays but no video frames \(black screen\)", "no-video"/);
  assert.match(autoRetry, /"room stream produced no video", "no-video"/);
  assert.match(autoRetry, /`playback error "\$\{snap\.errorCode\}"`, "playback"/);
  assert.match(autoRetry, /status: 0, host: hostOf\(src\.url\), cause \}/);
  assert.match(card, /error\.cause === "no-video"/);
  assert.match(card, /t\("No video"\)/);
  assert.match(card, /t\("Playback error"\)/);
});
