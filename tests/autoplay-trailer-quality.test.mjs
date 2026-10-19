import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = new Map();
function evaluate(file, resolve, window = {}, navigator = {}) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(
      readFileSync(new URL("../src/" + file, import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } },
    ).outputText);
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", "navigator", "console", compiled.get(file))(
    resolve, module, module.exports, window, navigator, { error() {} },
  );
  return module.exports;
}

function trailers(invoke, connection) {
  return evaluate("lib/trailer.ts", name => {
    if (name === "@tauri-apps/api/core") return { invoke, convertFileSrc: path => path };
    return {};
  }, { __TAURI_INTERNALS__: {} }, { connection });
}

const info = { file_path: "trailer.mp4", quality: "720p", duration_seconds: 120, title: "Trailer", size_bytes: 2048 };

test("autoplay resolution uses the selected quality and Auto follows the connection", () => {
  const fast = trailers(() => Promise.resolve(info));
  const slow = trailers(() => Promise.resolve(info), { downlink: 1 });
  assert.equal(fast.resolveTrailerQuality("auto"), "720p");
  assert.equal(slow.resolveTrailerQuality("auto"), "360p");
  assert.equal(slow.resolveTrailerQuality("1080p"), "1080p");
});

test("unavailable trailers fall through to the next distinct candidate at the selected resolution", async () => {
  const calls = [];
  const api = trailers(async (command, args) => {
    calls.push(args);
    if (args.videoId === "unavailable") throw new Error("unavailable");
    return info;
  });
  const result = await api.fetchFirstTrailer(["", "unavailable", "unavailable", "working", "unused"], "1080p");
  assert.equal(result, info);
  assert.deepEqual(calls, [
    { videoId: "unavailable", quality: "1080p" },
    { videoId: "working", quality: "1080p" },
  ]);
});

test("changing page during retrieval prevents another candidate from starting", async () => {
  let current = true;
  let calls = 0;
  const api = trailers(async () => {
    calls += 1;
    current = false;
    throw new Error("unavailable");
  });
  assert.equal(await api.fetchFirstTrailer(["first", "second"], "720p", () => current), null);
  assert.equal(calls, 1);
});

test("different requested resolutions do not reuse the same cached download", async () => {
  const calls = [];
  const api = trailers(async (command, args) => { calls.push(args.quality); return info; });
  await api.fetchFirstTrailer(["working"], "360p");
  await api.fetchFirstTrailer(["working"], "720p");
  await api.fetchFirstTrailer(["working"], "720p");
  assert.deepEqual(calls, ["360p", "720p"]);
});

function settingsViews(settings) {
  settings = { cwSources: {}, ...settings };
  const patches = [];
  let control;
  const placeholders = new Proxy({}, { get: (target, key) => String(key) });
  const resolve = name => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/settings") return { useSettings: () => ({ settings, update: patch => patches.push(patch) }) };
    if (name === "@/lib/i18n") return { useT: () => value => value };
    if (name === "../autoplay-trailer-quality") return control;
    return placeholders;
  };
  control = evaluate("views/settings/autoplay-trailer-quality.tsx", resolve);
  return {
    control: control.AutoplayTrailerQuality,
    trailers: evaluate("views/settings/quality-panel/trailers-tab.tsx", resolve).TrailersTab,
    home: evaluate("views/settings/library-panel/home-tab.tsx", resolve).HomeTab,
    patches,
  };
}

function findType(node, type) {
  if (Array.isArray(node)) return node.flatMap(child => findType(child, type));
  if (!node || typeof node !== "object") return [];
  return [...(node.type === type ? [node] : []), ...findType(node.props?.children, type)];
}

for (const heroTrailers of [false, true]) {
  for (const detailTrailerAutoplay of [false, true]) {
    test("resolution control visibility: home=" + heroTrailers + ", detail=" + detailTrailerAutoplay, () => {
      const views = settingsViews({ heroTrailers, detailTrailerAutoplay, autoplayTrailerQuality: "720p" });
      assert.equal(findType(views.trailers(), views.control).length, heroTrailers || detailTrailerAutoplay ? 1 : 0);
      assert.equal(findType(views.home(), views.control).length, heroTrailers ? 1 : 0);
    });
  }
}

test("the resolution dropdown changes autoplay quality independently of manual trailer quality", () => {
  const settings = { autoplayTrailerQuality: "720p", trailerQuality: "1080p" };
  const views = settingsViews(settings);
  const [dropdown] = findType(views.control(), "Dropdown");
  assert.equal(dropdown.props.value, "720p");
  assert.deepEqual(dropdown.props.options.map(option => option.value), ["auto", "360p", "720p", "1080p", "best"]);
  dropdown.props.onChange("1080p");
  assert.deepEqual(views.patches, [{ autoplayTrailerQuality: "1080p" }]);
  assert.equal(settings.trailerQuality, "1080p");
});
