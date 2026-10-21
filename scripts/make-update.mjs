// Prepare one release for the self-hosted updater. Runs on YOUR PC, never on the server.
//
//   node scripts/make-update.mjs --dir <folder with the built installers> --version 0.9.133 [--notes-file notes.txt]
//
// Expects, in --dir:  Compass_<v>_x64-setup.exe + .sig   (and optionally Compass_<v>_aarch64.app.tar.gz + .sig)
// Checks every installer against the public key in src-tauri/tauri.conf.json (a real Ed25519 check, the same
// one the app does), refuses to continue on any mismatch, then writes release-out/<v>/ with the installers and
// manifest.json. Upload that folder to the server and activate it with deploy/vps/updates-ctl.sh.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ARTIFACT_RE, SEMVER_RE, TARGET_OF, buildManifest, verifyFile } from "./lib/update-manifest.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : fallback;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const dir = arg("dir");
const version = arg("version");
const notesFile = arg("notes-file");
const origin = arg("origin", process.env.COMPASS_PUBLIC_ORIGIN || "https://compass.sarl");
const outRoot = resolve(arg("out", "release-out"));

if (!dir || !version || !SEMVER_RE.test(version)) {
  fail("usage: node scripts/make-update.mjs --dir <artifacts> --version 0.9.133 [--notes-file notes.txt] [--origin https://compass.sarl] [--out release-out]");
}
if (!existsSync(dir)) fail(`folder not found: ${dir}`);

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const pubkey = conf?.plugins?.updater?.pubkey;
if (!pubkey) fail("src-tauri/tauri.conf.json has no plugins.updater.pubkey");

const names = readdirSync(dir).filter((f) => {
  const m = ARTIFACT_RE.exec(f);
  return m && m[1] === version;
});
if (!names.some((f) => f.endsWith("x64-setup.exe"))) fail(`no Compass_${version}_x64-setup.exe in ${dir}`);

const out = join(outRoot, version);
mkdirSync(out, { recursive: true });

const files = [];
for (const file of names.sort()) {
  const path = join(dir, file);
  const sigPath = `${path}.sig`;
  if (!existsSync(sigPath)) fail(`${file}.sig is missing (build with TAURI_SIGNING_PRIVATE_KEY_PATH set and createUpdaterArtifacts on)`);
  const signature = readFileSync(sigPath, "utf8").trim();
  const checked = await verifyFile(path, signature, pubkey);
  if (!checked.ok) fail(`${file}: ${checked.reason}`);
  const tail = ARTIFACT_RE.exec(file)[2];
  files.push({ target: TARGET_OF[tail], file, signature });
  copyFileSync(path, join(out, file));
  copyFileSync(sigPath, join(out, `${file}.sig`));
  console.log(`ok  ${file}  (${(statSync(path).size / 1048576).toFixed(1)} MB, signature verified)`);
}

const notes = notesFile ? readFileSync(notesFile, "utf8").replace(/\r\n/g, "\n").trim() : "";
const manifest = buildManifest({ version, notes, origin, files });
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest)}\n`);

console.log(`\nReady: ${out}`);
console.log("Next:");
console.log(`  scp -r "${out}" debian@<server>:/tmp/compass-release-${version}`);
console.log(`  ssh debian@<server> sudo bash /srv/compass/deploy/vps/updates-ctl.sh publish ${version}`);
