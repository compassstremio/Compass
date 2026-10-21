import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Call = { method: "GET" | "POST"; path: string; body?: unknown; bearer?: boolean };

function harness(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const run = async (call: Call) => {
    calls.push(call);
    const out = respond(call);
    if (out instanceof Error) throw out;
    return out;
  };
  const dependencies = {
    "./client": {
      getJson: (path: string, opts?: { bearer?: boolean }) =>
        run({ method: "GET", path, bearer: opts?.bearer }),
      postJson: (path: string, body: unknown, opts?: { bearer?: boolean }) =>
        run({ method: "POST", path, body, bearer: opts?.bearer }),
    },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("../src/lib/account/email.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const exports = {};
  new Function("require", "exports", output.outputText)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name as keyof typeof dependencies];
  }, exports);
  return { email: exports as typeof import("../src/lib/account/email.ts"), calls };
}

const ENABLED = {
  email: true,
  newsletter: { enabled: true, label: "Send me release news", defaultChecked: true },
};

test("capabilities are read once and then served from memory", async () => {
  const { email, calls } = harness(() => ENABLED);
  assert.equal(email.cachedEmailCapabilities(), null);
  assert.deepEqual(await email.loadEmailCapabilities(), ENABLED);
  assert.deepEqual(await email.loadEmailCapabilities(), ENABLED);
  assert.deepEqual(email.cachedEmailCapabilities(), ENABLED);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    method: "GET",
    path: "/identity/api/capabilities",
    bearer: undefined,
  });
});

test("a server without the route reads as email off, and is asked again later", async () => {
  const { email, calls } = harness(() => Object.assign(new Error("Not found"), { status: 404 }));
  assert.deepEqual(await email.loadEmailCapabilities(), email.NO_EMAIL);
  assert.equal(email.cachedEmailCapabilities(), null);
  await email.loadEmailCapabilities();
  assert.equal(calls.length, 2);
});

test("a malformed answer never turns email on", async () => {
  const { email } = harness(() => ({ email: "yes", newsletter: { enabled: 1, label: 5 } }));
  assert.deepEqual(await email.loadEmailCapabilities(), email.NO_EMAIL);
});

test("the newsletter is off whenever email is off", async () => {
  const { email } = harness(() => ({ ...ENABLED, email: false }));
  assert.deepEqual(await email.loadEmailCapabilities(), email.NO_EMAIL);
});

test("normaliseEmail matches the server: trimmed, lowercased, shape-checked", () => {
  const { email } = harness(() => ({}));
  assert.equal(email.normaliseEmail("  Me@Example.COM "), "me@example.com");
  assert.equal(email.normaliseEmail("me@example"), "");
  assert.equal(email.normaliseEmail("me example@x.io"), "");
  assert.equal(email.normaliseEmail(""), "");
});

test("attach and resend are signed-in calls with the expected bodies", async () => {
  const { email, calls } = harness(() => ({ pending: true }));
  await email.attachEmail(" Me@Example.com ", true);
  await email.resendEmailVerification();
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
  const { email, calls } = harness(() => ({ sent: true }));
  await email.requestPasswordReset("Me@Example.com");
  assert.deepEqual(calls, [
    {
      method: "POST",
      path: "/identity/api/password/reset/request",
      body: { email: "me@example.com" },
      bearer: undefined,
    },
  ]);
});
