import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Call = { method: "GET" | "POST"; path: string; body?: unknown; bearer?: boolean };

function load<T>(file: string, respond: (call: Call) => unknown, extra: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const run = async (call: Call) => {
    calls.push(call);
    const out = respond(call);
    if (out instanceof Error) throw out;
    return out;
  };
  const dependencies: Record<string, unknown> = {
    "./client": {
      getJson: (path: string, opts?: { bearer?: boolean }) =>
        run({ method: "GET", path, bearer: opts?.bearer }),
      postJson: (path: string, body: unknown, opts?: { bearer?: boolean }) =>
        run({ method: "POST", path, body, bearer: opts?.bearer }),
    },
    ...extra,
  };
  const output = ts.transpileModule(
    readFileSync(new URL(`../src/lib/account/${file}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const exports = {};
  new Function("require", "exports", output.outputText)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return { mod: exports as T, calls };
}

type Caps = typeof import("../src/lib/account/capabilities.ts");
type Email = typeof import("../src/lib/account/email.ts");
type Discord = typeof import("../src/lib/account/discord-link.ts");

const caps = (respond: (call: Call) => unknown) => load<Caps>("capabilities.ts", respond);
const email = (respond: (call: Call) => unknown) => load<Email>("email.ts", respond);
const discord = (respond: (call: Call) => unknown, applied: unknown[] = []) =>
  load<Discord>("discord-link.ts", respond, {
    "@/lib/theme-auth": {
      applyAuthResult: (d: unknown) => applied.push(d),
      applyServerUser: (u: unknown) => applied.push(u),
    },
    "@/lib/platform": { osClass: () => "windows" },
    "@/lib/window": { openUrl: () => {} },
  });

const ENABLED = {
  email: true,
  newsletter: { enabled: true, label: "Send me release news", defaultChecked: true },
  discord: true,
};

test("capabilities are read once and then served from memory", async () => {
  const { mod, calls } = caps(() => ENABLED);
  assert.equal(mod.cachedAccountCapabilities(), null);
  assert.deepEqual(await mod.loadAccountCapabilities(), ENABLED);
  assert.deepEqual(await mod.loadAccountCapabilities(), ENABLED);
  assert.deepEqual(mod.cachedAccountCapabilities(), ENABLED);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: "GET", path: "/identity/api/capabilities", bearer: undefined });
});

test("a server without the route reads as everything off, and is asked again later", async () => {
  const { mod, calls } = caps(() => Object.assign(new Error("Not found"), { status: 404 }));
  assert.deepEqual(await mod.loadAccountCapabilities(), mod.NO_CAPABILITIES);
  assert.equal(mod.cachedAccountCapabilities(), null);
  await mod.loadAccountCapabilities();
  assert.equal(calls.length, 2);
});

test("a malformed answer never turns anything on", async () => {
  const { mod } = caps(() => ({ email: "yes", newsletter: { enabled: 1, label: 5 }, discord: 1 }));
  assert.deepEqual(await mod.loadAccountCapabilities(), mod.NO_CAPABILITIES);
});

test("discord is reported on its own, whether or not email is on", async () => {
  const { mod } = caps(() => ({ ...ENABLED, email: false }));
  assert.deepEqual(await mod.loadAccountCapabilities(), { ...mod.NO_CAPABILITIES, discord: true });
});

test("normaliseEmail matches the server: trimmed, lowercased, shape-checked", () => {
  const { mod } = email(() => ({}));
  assert.equal(mod.normaliseEmail("  Me@Example.COM "), "me@example.com");
  assert.equal(mod.normaliseEmail("me@example"), "");
  assert.equal(mod.normaliseEmail("me example@x.io"), "");
  assert.equal(mod.normaliseEmail(""), "");
});

test("attach and resend are signed-in calls with the expected bodies", async () => {
  const { mod, calls } = email(() => ({ pending: true }));
  await mod.attachEmail(" Me@Example.com ", true);
  await mod.resendEmailVerification();
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/identity/api/email/attach",
      body: { email: "me@example.com", newsletterOptIn: true },
      bearer: true,
    },
    { method: "POST", path: "/identity/api/email/resend", body: {}, bearer: true },
  ]);
});

test("a password reset request is anonymous and sends only the address", async () => {
  const { mod, calls } = email(() => ({ sent: true }));
  await mod.requestPasswordReset("Me@Example.com");
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/identity/api/password/reset/request",
      body: { email: "me@example.com" },
      bearer: undefined,
    },
  ]);
});

test("a discord callback counts only with the state this attempt started", () => {
  const { mod } = discord(() => ({}));
  assert.deepEqual(mod.readDiscordCallback({ state: "s1", code: "c1", error: "" }, "s1"), { code: "c1" });
  assert.equal(mod.readDiscordCallback({ state: "other", code: "c1" }, "s1"), null);
  assert.equal(mod.readDiscordCallback({ code: "c1" }, "s1"), null);
  assert.deepEqual(
    mod.readDiscordCallback({ state: "s1", code: "", error: "access_denied" }, "s1"),
    { error: "access_denied" },
  );
  assert.equal(mod.readDiscordCallback({ state: "s1", code: "", error: "" }, "s1"), null);
  assert.equal(mod.readDiscordCallback(null, "s1"), null);
});

test("linking needs the desktop app", async () => {
  const { mod, calls } = discord(() => ({}));
  assert.equal(mod.canLinkDiscord(), false);
  await assert.rejects(mod.linkDiscord(), /desktop app/);
  assert.equal(calls.length, 0);
});

test("unlinking applies the returned user and hands back the rotated recovery key", async () => {
  const applied: unknown[] = [];
  const user = { id: "u1", username: "me" };
  const { mod, calls } = discord(() => ({ user, recoveryCode: "RC-2" }), applied);
  assert.deepEqual(await mod.unlinkDiscord(), { recoveryCode: "RC-2" });
  assert.deepEqual(calls, [
    { method: "POST", path: "/identity/api/discord/unlink", body: {}, bearer: true },
  ]);
  assert.deepEqual(applied, [user]);
});
