import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildManifest, parsePublicKey, verifyFile } from "../scripts/lib/update-manifest.mjs";

const wrap = (comment, raw) =>
  Buffer.from(`untrusted comment: ${comment}\n${raw.toString("base64")}\ntrusted comment: t\n${Buffer.alloc(64).toString("base64")}\n`).toString("base64");

function makeKey(keyId) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pk = publicKey.export({ type: "spki", format: "der" }).subarray(12);
  const pubkey = wrap("minisign public key", Buffer.concat([Buffer.from("Ed"), keyId, pk]));
  return { privateKey, pubkey };
}

function signFile(privateKey, keyId, bytes) {
  const digest = createHash("blake2b512").update(bytes).digest();
  const sig = sign(null, digest, privateKey);
  return wrap("signature from tauri secret key", Buffer.concat([Buffer.from("ED"), keyId, sig]));
}

function tmpFile(bytes) {
  const p = join(mkdtempSync(join(tmpdir(), "compass-upd-")), "Compass_1.0.0_x64-setup.exe");
  writeFileSync(p, bytes);
  return p;
}

const KEY_ID = Buffer.from("0123456789abcdef", "hex");
const BYTES = Buffer.from("installer bytes");

test("a file signed by the trusted key verifies", async () => {
  const { privateKey, pubkey } = makeKey(KEY_ID);
  const res = await verifyFile(tmpFile(BYTES), signFile(privateKey, KEY_ID, BYTES), pubkey);
  assert.deepEqual(res, { ok: true });
});

test("a file changed after signing is rejected", async () => {
  const { privateKey, pubkey } = makeKey(KEY_ID);
  const sig = signFile(privateKey, KEY_ID, BYTES);
  const res = await verifyFile(tmpFile(Buffer.from("tampered")), sig, pubkey);
  assert.equal(res.ok, false);
});

test("a signature from another key is rejected with a clear reason", async () => {
  const mine = makeKey(KEY_ID);
  const otherId = Buffer.from("fedcba9876543210", "hex");
  const other = makeKey(otherId);
  const res = await verifyFile(tmpFile(BYTES), signFile(other.privateKey, otherId, BYTES), mine.pubkey);
  assert.equal(res.ok, false);
  assert.match(res.reason, /tauri\.conf\.json trusts key/);
});

test("garbage is rejected, not thrown", async () => {
  const { pubkey } = makeKey(KEY_ID);
  const res = await verifyFile(tmpFile(BYTES), "not-a-signature", pubkey);
  assert.equal(res.ok, false);
  assert.throws(() => parsePublicKey("nope"));
});

test("manifest has the shape the app consumes", () => {
  const m = buildManifest({
    version: "1.2.3",
    notes: "fixes",
    origin: "https://compass.sarl/",
    files: [{ target: "windows-x86_64", file: "Compass_1.2.3_x64-setup.exe", signature: " SIG \n" }],
    now: Date.UTC(2026, 9, 17),
  });
  assert.deepEqual(m, {
    version: "1.2.3",
    notes: "fixes",
    pub_date: "2026-10-17T00:00:00.000Z",
    platforms: {
      "windows-x86_64": { signature: "SIG", url: "https://compass.sarl/updates/1.2.3/Compass_1.2.3_x64-setup.exe" },
    },
  });
  assert.throws(() => buildManifest({ version: "1.2", origin: "x", files: [] }));
});
