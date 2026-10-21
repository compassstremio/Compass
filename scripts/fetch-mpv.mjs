import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("[mpv] not Windows, skipping bundled mpv.exe");
  process.exit(0);
}

const RELEASE = "20261010";
const SPECS = {
  x64: {
    asset: "mpv-x86_64-20261010-git-b2c255c13e.7z",
    sha256: "70a568c046a10f0b365319c4ec5382d8fb37f509615944b7e9932b66e5ccfb25",
  },
  arm64: {
    asset: "mpv-aarch64-20261010-git-b2c255c13e.7z",
    sha256: "c3aabf7bcc2c7b1350b46571e992437d53164a7f11ff54010d8715a913c80f2f",
  },
};

const spec = SPECS[process.arch];
if (!spec) {
  throw new Error(`[mpv] unsupported Windows architecture: ${process.arch}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "src-tauri", "binaries", "mpv-x86_64-pc-windows-msvc.exe");

if (existsSync(destination) && statSync(destination).size > 0) {
  console.log(`[mpv] ${destination} already present`);
  process.exit(0);
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return null;
}

const url = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/${RELEASE}/${spec.asset}`;
const temp = mkdtempSync(join(tmpdir(), "compass-mpv-"));

try {
  console.log(`[mpv] fetching ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`[mpv] download failed (${response.status} ${response.statusText})`);

  const archive = join(temp, spec.asset);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== spec.sha256) throw new Error(`[mpv] checksum mismatch (expected ${spec.sha256}, got ${digest})`);
  writeFileSync(archive, bytes);

  const extracted = join(temp, "extracted");
  mkdirSync(extracted);
  try {
    execFileSync("7z", ["x", "-y", archive, `-o${extracted}`], { stdio: "inherit" });
  } catch {
    throw new Error("[mpv] extraction failed; install 7-Zip and ensure `7z` is on PATH");
  }

  const mpv = findFile(extracted, "mpv.exe");
  if (!mpv) throw new Error("[mpv] mpv.exe was not found in the archive");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(mpv, destination);
  console.log(`[mpv] wrote ${destination}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
