import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const BASE = "compass.publicmetadb.session.v1";
const SESSION = { apiKey: "pm-testkey", username: "fixture", validatedAt: 123 };

function fixture(initial: Record<string, string> = {}) {
  const disk = { ...initial };
  const listeners = new Map<string, Set<() => void>>();
  const local = new Map<string, string>();
  const timers: Array<() => void> = [];
  let profile = "p1";
  const window = {
    addEventListener(name: string, fn: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn),
    dispatchEvent(event: Event) {
      for (const fn of listeners.get(event.type) ?? []) fn();
      return true;
    },
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
  };
  const localStorage = {
    get length() { return local.size; },
    key: (i: number) => [...local.keys()][i] ?? null,
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  };
  const profiles = {
    activeProfileId: () => profile,
    activeProfileIsPrimary: () => profile === "p1",
    profilesForSessionAdoption: () => [profile, "p1"],
  };
  const load = (file: string, mocks: Record<string, unknown>) => {
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const api: any = {};
    new Function("require", "exports", "window", "localStorage", output)((name: string) => {
      assert.ok(name in mocks, `Unexpected dependency ${name}`);
      return mocks[name];
    }, api, window, localStorage);
    return api;
  };
  const secrets = load("src/lib/secret-store.ts", {
    "./active-profile-id": profiles,
    "@tauri-apps/api/core": {
      invoke: async (command: string, args?: { content: string }) => {
        if (command === "secrets_read") return JSON.stringify(disk);
        assert.equal(command, "secrets_write");
        for (const key of Object.keys(disk)) delete disk[key];
        Object.assign(disk, JSON.parse(args!.content));
      },
    },
  });
  const session = load("src/lib/publicmetadb/session.ts", {
    "@/lib/active-profile-id": profiles,
    "@/lib/secret-store": secrets,
  });
  return {
    session, secrets, disk, timers,
    selectProfile(next: string) { profile = next; session.resetForProfile(); },
  };
}

test("PMDB restores the saved session after an early startup read cached signed out", async () => {
  const h = fixture({ [`${BASE}.p1`]: JSON.stringify(SESSION) });
  assert.equal(h.session.getSession(), null);
  await h.secrets.loadSecrets();
  assert.deepEqual(h.session.getSession(), SESSION);
  assert.equal(h.session.isAuthenticated(), true);
});

test("loading persisted PMDB credentials notifies mounted session subscribers", async () => {
  const h = fixture({ [`${BASE}.p1`]: JSON.stringify(SESSION) });
  h.session.getSession();
  let restored = false;
  h.session.subscribeSession(() => { restored = h.session.isAuthenticated(); });
  await h.secrets.loadSecrets();
  assert.equal(restored, true);
});

test("PMDB credentials persist without a debounce timer and restore on the next boot", async () => {
  const h = fixture();
  await h.secrets.loadSecrets();
  h.session.setSession(SESSION);
  assert.equal(h.timers.length, 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.disk[`${BASE}.p1`], JSON.stringify(SESSION));
  const restarted = fixture(h.disk);
  assert.equal(restarted.session.getSession(), null);
  await restarted.secrets.loadSecrets();
  assert.deepEqual(restarted.session.getSession(), SESSION);
});

test("restoring PMDB credentials preserves profile isolation and explicit disconnect", async () => {
  const h = fixture({ [`${BASE}.p1`]: JSON.stringify(SESSION) });
  await h.secrets.loadSecrets();
  assert.deepEqual(h.session.getSession(), SESSION);
  h.selectProfile("p2");
  assert.equal(h.session.getSession(), null);
  h.selectProfile("p1");
  assert.deepEqual(h.session.getSession(), SESSION);
  h.session.setSession(null);
  await h.secrets.flushSecrets();
  const restarted = fixture(h.disk);
  await restarted.secrets.loadSecrets();
  assert.equal(restarted.session.getSession(), null);
});
