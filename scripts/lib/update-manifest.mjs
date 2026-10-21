// Pure helpers for building and checking a Tauri updater manifest (latest.json).
// No dependencies: Node's crypto does Ed25519 and BLAKE2b.
//
// Tauri signs an installer with minisign. Both the `.sig` file and the `pubkey` in tauri.conf.json are the
// minisign text wrapped in one more layer of base64. A signature is 74 bytes: 2-byte algorithm ("ED" =
// pre-hashed with BLAKE2b-512, which is what Tauri emits; "Ed" = signs the raw file), 8-byte key id,
// 64-byte Ed25519 signature. A public key is 42 bytes: "Ed", key id, 32-byte key.

import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const SEMVER_RE = /^\d+\.\d+\.\d+$/;
export const ARTIFACT_RE = /^Compass_(\d+\.\d+\.\d+)_(x64-setup\.exe|aarch64\.app\.tar\.gz)$/;
export const TARGET_OF = {
  "x64-setup.exe": "windows-x86_64",
  "aarch64.app.tar.gz": "darwin-aarch64",
};

function unwrap(b64) {
  const text = Buffer.from(String(b64 ?? "").trim(), "base64").toString("utf8");
  const lines = text.split(/\r?\n/);
  if (!lines[0] || !lines[0].startsWith("untrusted comment:") || !lines[1]) {
    throw new Error("not a minisign block");
  }
  return Buffer.from(lines[1].trim(), "base64");
}

export function parsePublicKey(pubkeyB64) {
  const raw = unwrap(pubkeyB64);
  if (raw.length !== 42 || raw.toString("latin1", 0, 2) !== "Ed") {
    throw new Error("pubkey is not a minisign Ed25519 public key");
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

export function parseSignature(sigB64) {
  const raw = unwrap(sigB64);
  const alg = raw.toString("latin1", 0, 2);
  if (raw.length !== 74 || (alg !== "Ed" && alg !== "ED")) {
    throw new Error("signature is not a minisign Ed25519 signature");
  }
  return { alg, keyId: raw.subarray(2, 10), sig: raw.subarray(10, 74) };
}

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("blake2b512");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest()));
  });
}

/** Cryptographically check that `path` was signed by the key in `pubkeyB64`. Never throws. */
export async function verifyFile(path, sigB64, pubkeyB64) {
  let pub;
  let sig;
  try {
    pub = parsePublicKey(pubkeyB64);
    sig = parseSignature(sigB64);
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (!pub.keyId.equals(sig.keyId)) {
    return {
      ok: false,
      reason: `signed with key ${sig.keyId.toString("hex")} but tauri.conf.json trusts key ${pub.keyId.toString("hex")}`,
    };
  }
  try {
    const message = sig.alg === "ED" ? await hashFile(path) : readFileSync(path);
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, pub.key]), format: "der", type: "spki" });
    return verify(null, message, key, sig.sig)
      ? { ok: true }
      : { ok: false, reason: "signature does not match the file (file changed after signing?)" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Manifest in the exact shape the app already consumes: { version, notes, pub_date, platforms }. */
export function buildManifest({ version, notes, origin, files, now = Date.now() }) {
  if (!SEMVER_RE.test(version)) throw new Error(`bad version ${version}`);
  const platforms = {};
  for (const { target, file, signature } of files) {
    platforms[target] = { signature: signature.trim(), url: `${origin.replace(/\/+$/, "")}/updates/${version}/${file}` };
  }
  if (!Object.keys(platforms).length) throw new Error("no platforms");
  return { version, notes: String(notes ?? ""), pub_date: new Date(now).toISOString(), platforms };
}
