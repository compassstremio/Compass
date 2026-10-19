import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Sessions follow the account, not the profile: a connection made once serves every
// profile on the device, and losing one to a debounce window costs a manual re-login
// (a rotated refresh token is invalid server-side as soon as it is issued).
const file = fileURLToPath(new URL("../src/lib/secret-store.ts", import.meta.url));
const ROSTER = JSON.stringify({
  activeId: "p_second",
  profiles: [
    { id: "p_main", isPrimary: true },
    { id: "p_second" },
  ],
});

function harness({ store: initial = {}, roster = ROSTER } = {}) {
  const writes = [];
  const timers = [];
  const state = { ...initial };
  const mocks = {
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        if (command === "secrets_read") return JSON.stringify(state);
        if (command === "secrets_write") {
          const parsed = JSON.parse(args.content);
          writes.push(parsed);
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, parsed);
        }
        return null;
      },
    },
  };
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  globalThis.window = {
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  globalThis.localStorage = {
    length: 0,
    key: () => null,
    getItem: (key) => (key === "compass.profiles.v1" ? roster : null),
    setItem: () => {},
    removeItem: () => {},
  };

  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (mocks[name]) return mocks[name];
    // The store only imports the profile roster for session adoption.
    if (name === "./active-profile-id") {
      const rosterIds = (() => {
        try {
          const parsed = JSON.parse(roster);
          return [parsed.activeId, ...parsed.profiles.filter((p) => p.isPrimary).map((p) => p.id), ...parsed.profiles.map((p) => p.id)];
        } catch {
          return [];
        }
      })();
      return {
        profilesForSessionAdoption: () => [...new Set(rosterIds.filter(Boolean))],
      };
    }
    throw new Error(`Unexpected import: ${name}`);
  };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return {
    api: module.exports,
    writes,
    timers,
    state,
    restore: () => {
      globalThis.window = originalWindow;
      globalThis.localStorage = originalStorage;
    },
  };
}

test("session keys persist immediately instead of waiting for the debounce", async () => {
  const h = harness();
  try {
    await h.api.loadSecrets();
    h.api.setSecret("compass.trakt.session.v1", JSON.stringify({ refreshToken: "r" }));
    await h.api.flushSecrets();
    assert.equal(h.timers.length, 0, "a session write must not wait for a timer");
    assert.ok(h.writes.length >= 1, "the session write landed without a timer");
    assert.deepEqual(h.writes[0], { "compass.trakt.session.v1": '{"refreshToken":"r"}' });
    h.api.setSecret("compass.simkl.session.v1", JSON.stringify({ accessToken: "a" }));
    await h.api.flushSecrets();
    assert.deepEqual(h.writes[h.writes.length - 1], {
      "compass.trakt.session.v1": '{"refreshToken":"r"}',
      "compass.simkl.session.v1": '{"accessToken":"a"}',
    });
    h.api.setSecret("compass.trakt.session.v1", null);
    await h.api.flushSecrets();
    assert.deepEqual(h.writes[h.writes.length - 1], {
      "compass.simkl.session.v1": '{"accessToken":"a"}',
    });
  } finally {
    h.restore();
  }
});

test("keys outside the session set still batch behind the debounce", async () => {
  const h = harness();
  try {
    await h.api.loadSecrets();
    h.api.setSecret("compass.theme.choice", "dark");
    await Promise.resolve();
    assert.equal(h.writes.length, 0, "a plain key waits for the debounce");
    assert.equal(h.timers.length, 1);
    h.timers[0].fn();
    await h.api.flushSecrets();
    assert.ok(h.writes.length >= 1);
    assert.deepEqual(h.writes[h.writes.length - 1], { "compass.theme.choice": "dark" });
  } finally {
    h.restore();
  }
});

test("a session stored by another profile is adopted into the shared key", async () => {
  const h = harness({
    store: { "compass.trakt.session.v1.p_main": '{"refreshToken":"from-main"}' },
  });
  try {
    await h.api.loadSecrets();
    const found = h.api.readSharedSecret("compass.trakt.session.v1");
    assert.equal(found, '{"refreshToken":"from-main"}');
    await h.api.flushSecrets();
    const secrets = h.api.getAllSecrets();
    assert.equal(secrets["compass.trakt.session.v1"], '{"refreshToken":"from-main"}');
    assert.equal(secrets["compass.trakt.session.v1.p_main"], undefined, "the old copy moves, never duplicates");
    assert.equal(h.timers.length, 0, "adoption is not a debounced write");
  } finally {
    h.restore();
  }
});

test("the active profile's own session is preferred over the main profile's", async () => {
  const h = harness({
    store: {
      "compass.trakt.session.v1.p_second": '{"refreshToken":"from-second"}',
      "compass.trakt.session.v1.p_main": '{"refreshToken":"from-main"}',
    },
  });
  try {
    await h.api.loadSecrets();
    assert.equal(h.api.readSharedSecret("compass.trakt.session.v1"), '{"refreshToken":"from-second"}');
    await h.api.flushSecrets();
    const secrets = h.api.getAllSecrets();
    assert.equal(secrets["compass.trakt.session.v1.p_main"], '{"refreshToken":"from-main"}', "the untouched copy stays");
  } finally {
    h.restore();
  }
});

test("a disconnect clears the per-profile copies so nothing resurrects it", async () => {
  const h = harness({
    store: {
      "compass.simkl.session.v1": '{"accessToken":"shared"}',
      "compass.simkl.session.v1.p_main": '{"accessToken":"copy"}',
      "compass.simkl.session.v1.p_second": '{"accessToken":"copy"}',
    },
  });
  try {
    await h.api.loadSecrets();
    h.api.writeSharedSecret("compass.simkl.session.v1", null);
    await h.api.flushSecrets();
    const secrets = h.api.getAllSecrets();
    assert.deepEqual(
      Object.keys(secrets).filter((key) => key.startsWith("compass.simkl.session")),
      [],
    );
    assert.equal(h.api.readSharedSecret("compass.simkl.session.v1"), null);
  } finally {
    h.restore();
  }
});
