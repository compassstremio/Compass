import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("a music launch link survives until the app subscribes, then warm links arrive once", () => {
  const compiled = ts.transpileModule(
    readFileSync(new URL("../src/lib/deep-link.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const api: Record<string, any> = {};
  new Function("require", "exports", compiled)(() => ({}), api);
  const link = { kind: "track", artist: "AC/DC", name: "A/B" };
  api.emitDeepLinkOpenMusic(link);
  const received: unknown[] = [];
  const stop = api.onDeepLinkOpenMusic((value: unknown) => received.push(value));
  assert.deepEqual(received, [link]);
  api.emitDeepLinkOpenMusic({ ...link, name: "Another track" });
  assert.equal(received.length, 2);
  stop();
  const stopNext = api.onDeepLinkOpenMusic((value: unknown) => received.push(value));
  assert.equal(received.length, 2);
  stopNext();
});
