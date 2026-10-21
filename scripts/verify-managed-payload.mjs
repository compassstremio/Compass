import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url));
// Built binaries live in CARGO_TARGET_DIR when it is set, else in each crate's own target/.
const builtRelease = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR, "release") : null;
const readBuilt = (defaultPath, name) => (builtRelease ? readFileSync(resolve(builtRelease, name)) : read(defaultPath));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = JSON.parse(read("src-tauri/tauri.conf.json")).version;
assert.equal(read("installer/src-tauri/payload/version.txt").toString().trim(), version);
const payload = read("installer/src-tauri/payload/compass-payload.zip");
const entries = unzipSync(payload, {
  filter: ({ name }) => name === "compass.exe" || name === "uninstall.exe",
});
for (const [name, path, built] of [
  ["compass.exe", "src-tauri/target/release/compass.exe", "compass.exe"],
  ["uninstall.exe", "installer/src-tauri/target/release/compass-uninstall.exe", "compass-uninstall.exe"],
]) {
  assert.ok(entries[name], "Missing payload entry: " + name);
  assert.equal(hash(entries[name]), hash(readBuilt(path, built)), "Stale payload entry: " + name);
}
if (process.argv.includes("--embedded")) {
  const installer = readBuilt("installer/src-tauri/target/release/compass-setup.exe", "compass-setup.exe");
  assert.ok(installer.indexOf(payload) >= 0, "Installer does not embed the verified payload");
}
console.log("Managed payload verified for " + version + "; SHA-256 " + hash(payload));
