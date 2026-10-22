import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load() {
  const output = ts.transpileModule(
    readFileSync(new URL("../src/lib/account/email-deadline.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const exports = {};
  new Function("require", "exports", output.outputText)((name: string) => {
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return exports as typeof import("../src/lib/account/email-deadline.ts");
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const by = (offset: number) => new Date(NOW + offset).toISOString();
const author = (fields: Record<string, unknown>) => ({ id: "u1", username: "me", ...fields });

test("no prompt when email is off, nobody is signed in, or the address is confirmed", () => {
  const d = load();
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(DAY) }), false, NOW), { kind: "none" });
  assert.deepEqual(d.verifyPromptState(null, true, NOW), { kind: "none" });
  assert.deepEqual(
    d.verifyPromptState(author({ emailVerified: true, emailVerifyBy: by(DAY) }), true, NOW),
    { kind: "none" },
  );
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: null }), true, NOW), { kind: "none" });
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: "soon" }), true, NOW), { kind: "none" });
});

test("before the deadline it counts whole days left, never zero", () => {
  const d = load();
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(30 * DAY) }), true, NOW), {
    kind: "reminder",
    daysLeft: 30,
  });
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(DAY + 1) }), true, NOW), {
    kind: "reminder",
    daysLeft: 2,
  });
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(1000) }), true, NOW), {
    kind: "reminder",
    daysLeft: 1,
  });
});

test("from the deadline on it is overdue", () => {
  const d = load();
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(0) }), true, NOW), { kind: "overdue" });
  assert.deepEqual(d.verifyPromptState(author({ emailVerifyBy: by(-DAY) }), true, NOW), {
    kind: "overdue",
  });
});

test("a reminder put off with Later comes back after a day; overdue ignores Later", () => {
  const d = load();
  const reminder = { kind: "reminder", daysLeft: 10 } as const;
  assert.equal(d.promptDue(reminder, null, NOW), true);
  assert.equal(d.promptDue(reminder, NOW - DAY + 1, NOW), false);
  assert.equal(d.promptDue(reminder, NOW - DAY, NOW), true);
  assert.equal(d.promptDue({ kind: "overdue" }, NOW - 1000, NOW), true);
  assert.equal(d.promptDue({ kind: "none" }, null, NOW), false);
});
