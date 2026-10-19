import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function harness() {
  const slots = [], effects = [], lists = [], links = [], players = [];
  const settings = { tbKey: "fixture-A" };
  let slot = 0, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => ({ type, props });
  const pending = (array, signal) => new Promise(resolve => array.push({ resolve, signal }));
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: value => { const i = slot++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef: value => { const i = slot++; return slots[i] ??= { current: value }; },
      useMemo: fn => fn(),
      useEffect: (run, deps) => { const i = slot++; if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: run() };
      }); },
    },
    "lucide-react": {}, "@/assets/addon-logos/torbox.png": { default: "fixture" },
    "@/lib/media-file": { isPlayableVideoPath: name => name.endsWith(".mkv") },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/view": { useView: () => ({ openPlayer: value => players.push(value), openSettings() {} }) },
    "@/lib/debrid/torbox-cloud": {
      listTorboxCloud: (_key, signal) => pending(lists, signal),
      torboxCloudLink: (_key, _item, _file, signal) => pending(links, signal),
    },
  };
  const code = ts.transpileModule(readFileSync(new URL("../src/views/library/torbox-tab.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const api = {};
  new Function("require", "exports", code)(id => { assert.ok(id in dependencies, id); return dependencies[id]; }, api);
  const render = () => { slot = 0; tree = api.TorboxTab(); effects.splice(0).forEach(fn => fn()); };
  const buttons = () => {
    const result = [], visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) {
      if (node.type === "button") result.push(node); visit(node.props.children);
    } };
    visit(tree); return result;
  };
  render();
  return { settings, render, lists, links, players, buttons,
    unmount: () => { for (const item of slots) item?.cleanup?.(); },
  };
}
const item = { kind: "torrents", id: 1, name: "Fixture", files: [{ id: 2, name: "fixture.mkv" }] };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("TorBox playback uses a private cloud source and ignores late links after account changes", async () => {
  const h = harness(); h.lists[0].resolve([item]); await settle(); h.render();
  h.buttons().at(-1).props.onClick();
  h.links[0].resolve("https://example.invalid/fixture.mkv"); await settle(); h.render();
  assert.equal(h.players.length, 1);
  assert.equal(h.players[0].suppressCloudSync, true);
  assert.equal(h.players[0].meta.id, "torbox:torrents:1:2");
  h.buttons().at(-1).props.onClick();
  h.settings.tbKey = "fixture-B"; h.render();
  assert.equal(h.links[1].signal.aborted, true);
  h.links[1].resolve("https://example.invalid/stale.mkv"); await settle(); h.render();
  assert.equal(h.players.length, 1);
});

test("TorBox unmount cancels listing and playback requests", async () => {
  const h = harness(); h.lists[0].resolve([item]); await settle(); h.render();
  h.buttons().at(-1).props.onClick(); h.unmount();
  assert.equal(h.lists[0].signal.aborted, true);
  assert.equal(h.links[0].signal.aborted, true);
  h.links[0].resolve("https://example.invalid/stale.mkv"); await settle();
  assert.equal(h.players.length, 0);
});
