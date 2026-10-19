import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// A secret must survive a restart even when the Rust-side write fails: the localStorage
// copy is only dropped after the write is confirmed, and a leftover copy wins on boot.
const file = fileURLToPath(new URL("../src/lib/secret-store.ts", import.meta.url));
const KEY = "compass.trakt.session.v1";

function harness({ disk = {}, local = {} } = {}) {
  const state = { disk: { ...disk }, failWrites: false, writeCalls: 0 };
  const storage = new Map(Object.entries(local));
  const timers = [];
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  globalThis.window = {
    setTimeout: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key: (i) => [...storage.keys()][i] ?? null,
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => void storage.set(k, v),
    removeItem: (k) => void storage.delete(k),
  };
  const mocks = {
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        if (command === "secrets_read") return JSON.stringify(state.disk);
        state.writeCalls += 1;
        if (state.failWrites) throw new Error("disk full");
        state.disk = JSON.parse(args.content);
        return null;
      },
    },
    "./active-profile-id": { profilesForSessionAdoption: () => [] },
  };
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((n) => mocks[n], module, module.exports);
  return {
    api: module.exports,
    state,
    storage,
    timers,
    restore: () => {
      globalThis.window = originalWindow;
      globalThis.localStorage = originalStorage;
    },
  };
}

test("a failed secret write keeps the local copy and reports the failure", async () => {
  const h = harness();
  try {
    await h.api.loadSecrets();
    h.state.failWrites = true;
    h.api.setSecret(KEY, "token-1");
    const ok = await h.api.flushSecrets();
    assert.equal(ok, false);
    assert.equal(h.storage.get(KEY), "token-1", "the local copy must outlive a failed write");
    assert.equal(h.api.getSecret(KEY), "token-1");
    assert.ok(h.timers.some((t) => t.ms === 5000), "a retry is scheduled");
  } finally {
    h.restore();
  }
});

test("a retry after a failed write persists the secret and drops the local copy", async () => {
  const h = harness();
  try {
    await h.api.loadSecrets();
    h.state.failWrites = true;
    h.api.setSecret(KEY, "token-1");
    await h.api.flushSecrets();
    h.state.failWrites = false;
    assert.equal(await h.api.flushSecrets(), true);
    assert.equal(h.state.disk[KEY], "token-1");
    assert.equal(h.storage.has(KEY), false);
  } finally {
    h.restore();
  }
});

test("after a restart an unpersisted local copy wins over the stale file value", async () => {
  const h = harness({ disk: { [KEY]: "old" }, local: { [KEY]: "new" } });
  try {
    await h.api.loadSecrets();
    assert.equal(h.api.getSecret(KEY), "new");
    assert.equal(h.state.disk[KEY], "new");
    assert.equal(h.storage.has(KEY), false);
  } finally {
    h.restore();
  }
});

test("an update that lands while a write is in flight is not dropped from local storage", async () => {
  const h = harness();
  try {
    await h.api.loadSecrets();
    h.api.setSecret(KEY, "first");
    h.api.setSecret(KEY, "second");
    await h.api.flushSecrets();
    assert.equal(h.state.disk[KEY], "second");
    assert.equal(h.api.getSecret(KEY), "second");
  } finally {
    h.restore();
  }
});
