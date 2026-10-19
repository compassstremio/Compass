import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(name, dependencies) {
  const source = readFileSync(new URL(`../src/lib/streams/plugins/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (id) => {
      assert.ok(id in dependencies, `Unexpected dependency ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

test("disabled native installation stops before touching the filesystem or invoking Capstan", async () => {
  let calls = 0;
  let plugins = false;
  const native = load("native", {
    "@tauri-apps/api/core": { invoke: async () => calls++ },
    "@/lib/features/install": { readInstallFeatures: async () => ({ plugins }) },
    "./extension/bridge": { extensionsSupported: () => true },
    "./types": {
      PluginError: class extends Error {
        constructor(code) {
          super(code);
          this.code = code;
        }
      },
    },
  });
  await assert.rejects(native.installNativeArchive(new Uint8Array([1]), "test.cs3"), {
    code: "installation-disabled",
  });
  assert.equal(calls, 0);
  plugins = true;
  await native.requireAndroidExtensions();
  plugins = false;
  await assert.rejects(native.requireAndroidExtensions(), { code: "installation-disabled" });
});

test("blocking an existing Android plugin leaves health and saved settings untouched", async () => {
  let acquired = 0;
  let saved = 0;
  let ran = 0;
  const runtime = load("runtime", {
    "@/lib/manga/plugins/worker-host": {},
    "@/lib/debug": {},
    "./extension/run": { runExtensionPlugin: async () => ran++ },
    "./gate": { acquire: async () => acquired++ },
    "./native": {
      requireAndroidExtensions: async () => {
        throw new Error("installation-disabled");
      },
    },
    "./provider-compat/prelude": {},
    "./source": {},
    "./store": { saveStreamPlugin: async () => saved++ },
  });
  const plugin = {
    id: "saved",
    format: "android-extension",
    settingsValues: { language: "en" },
    failures: 2,
  };
  const original = structuredClone(plugin);
  await assert.rejects(
    runtime.runStreamPlugin(plugin, {}, new AbortController().signal, 1000),
    /installation-disabled/,
  );
  assert.equal(acquired, 0);
  assert.equal(ran, 0);
  assert.equal(saved, 0);
  assert.equal(runtime.pluginHealth(plugin.id), null);
  assert.deepEqual(plugin, original);
});
