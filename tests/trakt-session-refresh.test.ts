import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// A refresh token is rotated on every use, so losing the session to a transport error
// means the listener has to authorize by hand again. These pin the rule: only Trakt's
// own refusal of the refresh answer ends the connection.
const root = fileURLToPath(new URL("../src/lib/trakt/", import.meta.url));

function harness(responses) {
  const calls = [];
  const state = {
    session: {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      createdAt: 1,
      expiresIn: 604800,
      username: "listener",
    },
    clears: 0,
  };
  const mocks = {
    [path.join(root, "config.ts")]: {
      TRAKT_API_BASE: "https://api.trakt.tv",
      TRAKT_API_VERSION: "2",
      TRAKT_CLIENT_ID: "test-client",
      TRAKT_TOKEN_PROXY: "https://compass.test/api/trakt/token",
      TRAKT_VERIFY_URL: "https://trakt.tv/activate",
      REFRESH_THRESHOLD_SEC: 14 * 24 * 60 * 60,
      WRITE_MIN_INTERVAL_MS: 1000,
    },
    [path.join(root, "session.ts")]: {
      getSession: () => state.session,
      setSession: (value) => {
        state.session = value;
        if (value === null) state.clears += 1;
      },
    },
  };
  const cache = new Map();
  function load(filename) {
    const full = path.resolve(root, filename);
    if (mocks[full]) return mocks[full];
    if (cache.has(full)) return cache.get(full).exports;
    const compiled = ts.transpileModule(readFileSync(full, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    cache.set(full, module);
    const require = (name) => {
      if (mocks[name]) return mocks[name];
      assert.ok(name.startsWith("."), `Unexpected import: ${name}`);
      return load(path.resolve(path.dirname(full), `${name}.ts`));
    };
    new Function("require", "module", "exports", compiled)(require, module, module.exports);
    return module.exports;
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    assert.ok(next, `Unexpected request: ${url}`);
    if (typeof next === "function") return next();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    load,
    calls,
    state,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test("a transport failure during refresh keeps the session", async () => {
  const h = harness([json({}, 401), new TypeError("network down")]);
  try {
    await assert.rejects(h.load("client.ts").traktRequest("/sync/watchlist"), { status: 401 });
    assert.equal(h.state.clears, 0);
    assert.equal(h.state.session.refreshToken, "refresh-1");
    assert.equal(h.calls[1].url, "https://compass.test/api/trakt/token");
  } finally {
    h.restore();
  }
});

test("a server error or rate limit during refresh keeps the session", async () => {
  for (const status of [429, 500, 503]) {
    const h = harness([json({}, 401), json({ error: "busy" }, status)]);
    try {
      await assert.rejects(h.load("client.ts").traktRequest("/sync/watchlist"), { status: 401 });
      assert.equal(h.state.clears, 0, `status ${status} must not sign out`);
      assert.equal(h.state.session.refreshToken, "refresh-1");
    } finally {
      h.restore();
    }
  }
});

test("Trakt refusing the refresh token ends the connection", async () => {
  for (const status of [400, 401, 403]) {
    const h = harness([
      json({}, 401),
      json({ error: "invalid_grant", error_description: "invalid refresh token" }, status),
    ]);
    try {
      await assert.rejects(h.load("client.ts").traktRequest("/sync/watchlist"), { status: 401 });
      assert.equal(h.state.clears, 1, `status ${status} must end the session`);
      assert.equal(h.state.session, null);
    } finally {
      h.restore();
    }
  }
});

test("a session replaced mid-refresh is never cleared by the old answer", async () => {
  const h = harness([
    json({}, 401),
    () => {
      h.state.session = {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        createdAt: 2,
        expiresIn: 604800,
        username: "listener",
      };
      return json({ error: "invalid_grant" }, 400);
    },
  ]);
  try {
    await assert.rejects(h.load("client.ts").traktRequest("/sync/watchlist"), { status: 401 });
    assert.equal(h.state.clears, 0);
    assert.equal(h.state.session.refreshToken, "refresh-2");
  } finally {
    h.restore();
  }
});

test("the token proxy is called without Trakt API headers its preflight refuses", async () => {
  // Sending trakt-api-version/trakt-api-key here made the browser block the refresh with
  // a CORS preflight failure while the device-token login kept working, so a token could
  // never be renewed.
  const h = harness([
    json({}, 401),
    json({ access_token: "access-9", refresh_token: "refresh-9", created_at: 9, expires_in: 604800 }),
    json({ ok: true }),
  ]);
  try {
    assert.deepEqual(await h.load("client.ts").traktRequest("/sync/watchlist"), { ok: true });
    const proxy = h.calls[1];
    assert.equal(proxy.url, "https://compass.test/api/trakt/token");
    assert.deepEqual(Object.keys(proxy.init.headers).sort(), ["Content-Type"]);
    const api = h.calls[2];
    assert.equal(api.init.headers["trakt-api-key"], "test-client");
    assert.equal(api.init.headers["trakt-api-version"], "2");
    assert.equal(api.init.headers.Authorization, "Bearer access-9");
  } finally {
    h.restore();
  }
});

test("a working refresh replaces the stored tokens without signing out", async () => {
  const h = harness([
    json({}, 401),
    json({
      access_token: "access-3",
      refresh_token: "refresh-3",
      created_at: 3,
      expires_in: 604800,
    }),
    json({ ok: true }),
  ]);
  try {
    assert.deepEqual(await h.load("client.ts").traktRequest("/sync/watchlist"), { ok: true });
    assert.equal(h.state.clears, 0);
    assert.equal(h.state.session.refreshToken, "refresh-3");
    assert.equal(h.calls[2].init.headers.Authorization, "Bearer access-3");
  } finally {
    h.restore();
  }
});
