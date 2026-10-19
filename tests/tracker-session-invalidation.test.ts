import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// A session module caches what it parsed on first read. If that first read happened before
// the persisted secret store landed, the cache held null for the whole run: the account
// showed as signed out and its calls went out without a token. The store announcing itself
// must re-arm every session module - this is the regression caeda1e1 left behind.
const root = fileURLToPath(new URL("../src/lib/", import.meta.url));

function fixture() {
  const secrets = new Map();
  const readyListeners = new Set();
  const subscribers = new Set();
  const mocks = {
    "@/lib/active-profile-id": {
      activeProfileId: () => "p1",
      activeProfileIsPrimary: () => true,
    },
    "@/lib/secret-store": {
      getSecret: (key) => secrets.get(key) ?? null,
      setSecret: (key, value) => (value == null ? secrets.delete(key) : secrets.set(key, value)),
      subscribeSecretsReady: (fn) => {
        readyListeners.add(fn);
        return () => readyListeners.delete(fn);
      },
    },
  };
  const file = path.join(root, "mal/session.ts");
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (mocks[name]) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return {
    api: module.exports,
    secrets,
    readyListeners,
    subscribers,
    storeLands() {
      for (const fn of [...readyListeners]) fn();
    },
  };
}

const SESSION = JSON.stringify({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  createdAt: Math.floor(Date.now() / 1000),
  // MAL keeps this in milliseconds: isAuthenticated() compares Date.now() against it.
  expiresAt: Date.now() + 3600_000,
  userName: "listener",
});

test("a session read before the store lands is re-read once the store arrives", () => {
  const f = fixture();
  // The first read happens before secrets.json is in memory...
  assert.equal(f.api.getSession(), null);
  // ...the store lands...
  f.secrets.set("compass.mal.session.v1.p1", SESSION);
  f.storeLands();
  // ...and the account is readable instead of staying signed out for the whole run.
  assert.equal(f.api.getSession()?.userName, "listener");
  assert.equal(f.api.isAuthenticated(), true);
});

test("the store landing also notifies the provider subscribers", () => {
  const f = fixture();
  f.api.getSession();
  let notified = 0;
  f.api.subscribeSession(() => {
    notified += 1;
  });
  f.secrets.set("compass.mal.session.v1.p1", SESSION);
  f.storeLands();
  assert.ok(notified >= 1, "a mounted provider must be told to re-read");
});

test("every tracker session module re-arms when the secret store lands", () => {
  for (const module of ["simkl", "trakt", "mal", "anilist"]) {
    const source = readFileSync(path.join(root, `${module}/session.ts`), "utf8");
    assert.match(
      source,
      /subscribeSecretsReady\(resetForProfile\)/,
      `${module}/session.ts must re-arm on SECRETS_READY`,
    );
    assert.match(source, /export function resetForProfile\(\)[\s\S]{0,120}loaded = false/);
  }
});
