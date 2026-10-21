/*
 * fetch-binaries.mjs
 *
 * Downloads the Tauri "externalBin" sidecars (yt-dlp, ffmpeg, ffprobe) for the
 * CURRENT OS + arch and writes them to src-tauri/binaries/<name>-<triple>[.exe],
 * which is exactly the path tauri.conf.json externalBin resolves to at build time.
 *
 * Why this script exists:
 *   src-tauri/binaries/* is gitignored (see .gitignore), so a fresh clone ships
 *   NONE of these binaries. Without them `tauri build` dies with
 *   "resource path binaries/yt-dlp-<triple> doesn't exist". Run this once (via
 *   `pnpm run setup`) before building.
 *
 * ----------------------------------------------------------------------------
 * SOURCES - PLEASE VERIFY THESE URLS. They are "latest/rolling" upstream builds,
 * so they are intentionally NOT checksum pinned (unlike fetch-libmpv/fetch-fonts,
 * which pin a fixed asset). They also could NOT be test-downloaded in the
 * environment that wrote this script. VERIFY EACH ONE AT RUNTIME.
 * ----------------------------------------------------------------------------
 *
 * yt-dlp  (single self-contained binary, no archive)
 *   linux  x86_64 : github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
 *   linux  aarch64: github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64
 *   macOS  (both) : github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
 *                   (universal2; needs macOS 12+. For macOS 11 use yt-dlp_macos_legacy.)
 *   windows x86_64: github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
 *
 * ffmpeg + ffprobe  (extracted from an archive)
 *   linux  x86_64 : github.com/BtbN/FFmpeg-Builds latest ffmpeg-master-latest-linux64-gpl.tar.xz
 *   linux  aarch64: github.com/BtbN/FFmpeg-Builds latest ffmpeg-master-latest-linuxarm64-gpl.tar.xz
 *                   (was johnvansickle.com, which 415-blocks CI/automated GETs. BtbN is a
 *                    static standalone build hosted on GitHub releases, same as yt-dlp above.)
 *   macOS  (both) : evermeet.cx/ffmpeg/info/ffmpeg/release  and  .../ffprobe/release
 *                   (the old /getrelease endpoint is gone (410); the info API returns
 *                    JSON with versioned zip URLs. evermeet ships x86_64; on Apple
 *                    Silicon it runs under Rosetta.)
 *   windows x86_64: gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
 *                   (alt: github.com/BtbN/FFmpeg-Builds latest win64-gpl zip)
 *
 * Extraction tools (documented external dependency):
 *   .tar.xz -> `tar -xJf`  (linux; GNU tar + xz-utils)
 *   .zip    -> macOS: `unzip`   windows: PowerShell Expand-Archive   (both built in)
 *
 * Env overrides (mirrors / air-gapped): COMPASS_YTDLP_URL, COMPASS_FFMPEG_URL,
 * COMPASS_FFPROBE_URL replace the resolved URL for the current platform. Or just
 * drop the finished binary into src-tauri/binaries/<name>-<triple>[.exe] by hand.
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");

function targetTriple() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  return `${arch}-unknown-linux-gnu`;
}

const EXE = process.platform === "win32" ? ".exe" : "";
const triple = targetTriple();
const mb = (p) => (statSync(p).size / 1048576).toFixed(0);

const YTDLP = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const BTBN = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";
const EVERMEET_INFO = "https://evermeet.cx/ffmpeg/info";
const GYAN = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Resolve the actual download URL from the evermeet.cx info API.
 * The old `/getrelease/<name>/zip` endpoint is gone (410).
 * The info API (`/info/<name>/release`) returns JSON with versioned URLs.
 */
async function resolveEvermeetUrl(name) {
  const infoUrl = `${EVERMEET_INFO}/${name}/release`;
  console.log(`[binaries] resolving evermeet URL via ${infoUrl}`);
  const res = await fetch(infoUrl, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error(`evermeet info API failed (${res.status} ${res.statusText})`);
  const info = await res.json();
  const zipUrl = info?.download?.zip?.url;
  if (!zipUrl) throw new Error(`evermeet info API returned no zip URL for ${name}`);
  return zipUrl;
}

const SOURCES = {
  "yt-dlp": {
    "x86_64-unknown-linux-gnu": { kind: "raw", url: `${YTDLP}/yt-dlp_linux` },
    "aarch64-unknown-linux-gnu": { kind: "raw", url: `${YTDLP}/yt-dlp_linux_aarch64` },
    "x86_64-apple-darwin": { kind: "raw", url: `${YTDLP}/yt-dlp_macos` },
    "aarch64-apple-darwin": { kind: "raw", url: `${YTDLP}/yt-dlp_macos` },
    "x86_64-pc-windows-msvc": { kind: "raw", url: `${YTDLP}/yt-dlp.exe` },
  },
  ffmpeg: {
    "x86_64-unknown-linux-gnu": { kind: "tar.xz", url: `${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`, member: "ffmpeg" },
    "aarch64-unknown-linux-gnu": { kind: "tar.xz", url: `${BTBN}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`, member: "ffmpeg" },
    "x86_64-apple-darwin": { kind: "evermeet", infoName: "ffmpeg", member: "ffmpeg" },
    "aarch64-apple-darwin": { kind: "evermeet", infoName: "ffmpeg", member: "ffmpeg" },
    "x86_64-pc-windows-msvc": { kind: "zip", url: GYAN, member: "ffmpeg.exe" },
  },
  ffprobe: {
    "x86_64-unknown-linux-gnu": { kind: "tar.xz", url: `${BTBN}/ffmpeg-master-latest-linux64-gpl.tar.xz`, member: "ffprobe" },
    "aarch64-unknown-linux-gnu": { kind: "tar.xz", url: `${BTBN}/ffmpeg-master-latest-linuxarm64-gpl.tar.xz`, member: "ffprobe" },
    "x86_64-apple-darwin": { kind: "evermeet", infoName: "ffprobe", member: "ffprobe" },
    "aarch64-apple-darwin": { kind: "evermeet", infoName: "ffprobe", member: "ffprobe" },
    "x86_64-pc-windows-msvc": { kind: "zip", url: GYAN, member: "ffprobe.exe" },
  },
};

const OVERRIDE = {
  "yt-dlp": process.env.COMPASS_YTDLP_URL,
  ffmpeg: process.env.COMPASS_FFMPEG_URL,
  ffprobe: process.env.COMPASS_FFPROBE_URL,
};

const ENVVAR = {
  "yt-dlp": "COMPASS_YTDLP_URL",
  ffmpeg: "COMPASS_FFMPEG_URL",
  ffprobe: "COMPASS_FFPROBE_URL",
};

const dlCache = new Map();
async function download(url) {
  if (dlCache.has(url)) return dlCache.get(url);
  console.log(`[binaries] fetching ${url}`);
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "*/*" } });
  if (!res.ok) throw new Error(`download failed (${res.status} ${res.statusText})`);
  const buf = Buffer.from(await res.arrayBuffer());
  dlCache.set(url, buf);
  return buf;
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function findMember(dir, name) {
  let best = null;
  let bestSize = -1;
  for (const p of walk(dir, [])) {
    if (basename(p) !== name) continue;
    const size = statSync(p).size;
    if (size > bestSize) {
      best = p;
      bestSize = size;
    }
  }
  return best;
}

function extractMember(buf, kind, member, dest) {
  const tmp = mkdtempSync(join(tmpdir(), "compass-bin-"));
  try {
    const archive = join(tmp, kind === "tar.xz" ? "archive.tar.xz" : "archive.zip");
    writeFileSync(archive, buf);
    const outDir = join(tmp, "out");
    mkdirSync(outDir, { recursive: true });
    if (kind === "tar.xz") {
      execFileSync("tar", ["-xJf", archive, "-C", outDir], { stdio: "inherit" });
    } else if (process.platform === "win32") {
      execFileSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${outDir}" -Force`],
        { stdio: "inherit" },
      );
    } else {
      execFileSync("unzip", ["-oq", archive, "-d", outDir], { stdio: "inherit" });
    }
    const found = findMember(outDir, member);
    if (!found) throw new Error(`could not find ${member} inside archive`);
    copyFileSync(found, dest);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function hint(name) {
  const lines = [
    `[binaries] fix: set ${ENVVAR[name]} to a mirror URL, or drop a working`,
    `[binaries]      ${name}-${triple}${EXE} into src-tauri/binaries/ by hand.`,
  ];
  if (name === "yt-dlp") lines.push("[binaries]      source: github.com/yt-dlp/yt-dlp/releases/latest");
  else lines.push("[binaries]      static builds: johnvansickle.com (linux), evermeet.cx / osxexperts.net (macOS), gyan.dev or BtbN (windows)");
  return lines.join("\n");
}

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

let ok = true;
for (const name of ["yt-dlp", "ffmpeg", "ffprobe"]) {
  const dest = join(binDir, `${name}-${triple}${EXE}`);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[binaries] ${name}-${triple}${EXE} already present (${mb(dest)} MB)`);
    continue;
  }
  const spec = SOURCES[name][triple];
  if (!spec) {
    console.error(`[binaries] no known source for ${name} on ${triple}`);
    console.error(hint(name));
    ok = false;
    continue;
  }
  let url = OVERRIDE[name];
  let effectiveKind = spec.kind;
  if (!url) {
    if (spec.kind === "evermeet") {
      url = await resolveEvermeetUrl(spec.infoName);
      effectiveKind = "zip";
    } else {
      url = spec.url;
    }
  }
  try {
    const buf = await download(url);
    if (effectiveKind === "raw") writeFileSync(dest, buf);
    else extractMember(buf, effectiveKind, spec.member, dest);
    if (process.platform !== "win32") chmodSync(dest, 0o755);
    console.log(`[binaries] wrote ${name}-${triple}${EXE} (${mb(dest)} MB)`);
  } catch (err) {
    console.error(`[binaries] ${name} failed: ${err.message}`);
    console.error(hint(name));
    ok = false;
  }
}

if (!ok) {
  console.error("[binaries] one or more sidecars are missing; see messages above");
  process.exit(1);
}
console.log(`[binaries] all sidecars ready for ${triple}`);
