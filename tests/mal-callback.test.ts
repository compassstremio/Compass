import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isMalCallback, onMalCallback, receiveMalCallback } from "../src/lib/mal/callback";

test("MAL callbacks queue before subscription and reject malformed targets", () => {
  const url = "compass://mal?code=fixture&state=nonce";
  assert.equal(receiveMalCallback(url), true);
  const received: string[] = [];
  const stop = onMalCallback((value) => received.push(value));
  assert.deepEqual(received, [url]);
  stop();
  for (const invalid of ["https://mal?code=x&state=y", "compass://mal/other?code=x&state=y", "compass://mal?code=x", "compass://mal?code=x&code=y&state=z"]) {
    assert.equal(isMalCallback(invalid), false);
  }
});

function authFixture() {
  const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/mal/auth.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const values = new Map<string, string>();
  let profile = "default";
  let calls = 0;
  let saved: unknown;
  const api: Record<string, any> = {};
  const deps: Record<string, unknown> = {
    "./config": { MAL_CLIENT_ID: "fixture", MAL_AUTHORIZE_URL: "https://mal.example/authorize", MAL_TOKEN_PROXY: "https://proxy.example/token" },
    "./session": { getSession: () => null, setSession: (value: unknown) => { saved = value; } },
    "@/lib/active-profile-id": { activeProfileId: () => profile },
  };
  new Function("require", "exports", "sessionStorage", "window", "fetch", compiled)(
    (name: string) => deps[name], api,
    { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
    {}, async (url: string) => {
      calls++;
      return { ok: true, json: async () => url.includes("token")
        ? { access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 }
        : { name: "Fixture" } };
    },
  );
  return { api, calls: () => calls, saved: () => saved, switchProfile: () => { profile = "other"; } };
}

test("MAL automatic completion validates state and exchanges the matching verifier", async () => {
  const f = authFixture();
  const request = new URL(f.api.buildAuthorizeUrl());
  const state = request.searchParams.get("state");
  assert.match(state!, /^[A-Za-z0-9._~-]{64}$/);
  await assert.rejects(f.api.completeAuthorization("compass://mal?code=fixture&state=wrong", true), /another attempt/);
  assert.equal(f.calls(), 0);
  await f.api.completeAuthorization(`compass://mal?code=fixture&state=${state}`, true);
  assert.equal(f.calls(), 2);
  assert.ok(f.saved());
  await assert.rejects(f.api.completeAuthorization(`compass://mal?code=fixture&state=${state}`, true), /expired/);
});

test("cancelled attempts and changed profiles cannot complete a MAL login", async () => {
  const f = authFixture();
  f.api.buildAuthorizeUrl();
  f.api.cancelAuthorization();
  await assert.rejects(f.api.completeAuthorization("fixture"), /expired/);
  f.api.buildAuthorizeUrl();
  f.switchProfile();
  await assert.rejects(f.api.completeAuthorization("fixture"), /expired/);
  assert.equal(f.calls(), 0);
});
