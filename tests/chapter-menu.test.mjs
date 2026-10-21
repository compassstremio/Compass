import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  CONTROL_META,
  DEFAULT_DEFAULT_CONFIG,
  DEFAULT_STREMIO_CONFIG,
} from "../src/lib/player-chrome.ts";

function harness(chapters, positionSec = 0) {
  const slots = [], effects = [], events = new Map(), seeks = [], changes = [], dismissals = [];
  let slot = 0, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const jsx = (type, props) => {
    if (props?.ref) props.ref.current = { contains: node => node === "inside" };
    return { type, props };
  };
  const surface = {
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); },
  };
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: value => { const i = slot++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef: value => { const i = slot++; return slots[i] ??= { current: value }; },
      useMemo: fn => fn(), useCallback: fn => fn,
      useEffect: (run, deps) => { const i = slot++; if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: run() };
      }); },
    },
    "lucide-react": { ListTree: "list-icon", X: "close-icon" },
    "@/lib/i18n": { useT: () => (text, values) => values ? text.replace("{chapter}", values.chapter) : text },
    "./transport-utils": { fmtTime: value => `${value}s` },
    "./tooltip": { Tooltip: ({ children }) => children },
    // The shared helper also notes the dismissal so the player underneath does
    // not read the closing click as a tap. Seeing it here is the parity claim.
    "@/lib/player/overlay-dismiss": {
      watchOutsideMouseDown: handler => {
        const wrapped = event => { dismissals.push(true); handler(event); };
        surface.addEventListener("mousedown", wrapped);
        return () => surface.removeEventListener("mousedown", wrapped);
      },
    },
  };
  const source = readFileSync(new URL("../src/components/player/transport/chapter-menu.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const api = {};
  new Function("require", "exports", "document", "window", code)(id => {
    assert.ok(id in dependencies, `unexpected import ${id}`); return dependencies[id];
  }, api, surface, surface);
  const props = { chapters, positionSec, onSeek: value => seeks.push(value), onOpenChange: value => changes.push(value) };
  const render = () => { slot = 0; tree = api.ChapterMenu(props); effects.splice(0).forEach(fn => fn()); };
  const buttons = () => {
    const result = [];
    const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node?.props) {
      if (node.type === "button") result.push(node); visit(node.props.children);
    } };
    visit(tree); return result;
  };
  render();
  return { render, buttons, seeks, changes, dismissals, events, empty: () => tree === null,
    toggle() { buttons()[0].props.onClick(); render(); },
    unmount() { for (const item of slots) item?.cleanup?.(); },
  };
}

const badge = row => row.props.children.find(child => child?.type === "span" && /rounded-full/.test(child.props.className));

test("chapter menu orders valid chapters and seeks to the selected chapter", () => {
  const h = harness([{ startSec: 60, title: "Second" }, { startSec: NaN }, { startSec: 0, title: "First" }], 65);
  h.toggle();
  const rows = h.buttons().slice(2);
  assert.equal(rows.length, 2);
  // The row playing now is marked the way the audio menu marks its current track.
  assert.match(badge(rows[1]).props.className, /bg-accent/);
  assert.match(badge(rows[0]).props.className, /bg-raised/);
  rows[0].props.onClick(); h.render();
  assert.deepEqual(h.seeks, [0]);
  assert.deepEqual(h.changes, [false, true, false]);
  assert.equal(h.buttons()[0].props["aria-expanded"], false);
});

test("the chapters panel is a player control, not a hard-coded button", () => {
  assert.equal(CONTROL_META["chapter-menu"].group, "menus");
  assert.equal(CONTROL_META["chapter-menu"].defaultSlot, "bottom-right");
  for (const [name, config] of [["default", DEFAULT_DEFAULT_CONFIG], ["stremio", DEFAULT_STREMIO_CONFIG]]) {
    const entry = config.controls.find(control => control.id === "chapter-menu");
    assert.ok(entry, `${name} layout ships the chapters control`);
    assert.equal(entry.slot, "bottom-right", `${name} keeps it with the other menus`);
  }
});

test("Escape and outside clicks close chapters and remove listeners", () => {
  const h = harness([{ startSec: 0 }]);
  h.toggle(); h.events.get("mousedown")({ target: "inside" });
  assert.equal(h.changes.at(-1), true);
  assert.equal(h.dismissals.length, 1);
  h.events.get("keydown")({ key: "Escape" }); h.render();
  assert.equal(h.events.size, 0);
  h.toggle(); h.events.get("mousedown")({ target: "outside" }); h.render();
  assert.equal(h.buttons()[0].props["aria-expanded"], false);
  // Leaving playback with the panel open must not leave the transport's
  // "a menu is open" flag raised.
  h.toggle(); h.unmount();
  assert.equal(h.events.size, 0);
  assert.equal(h.changes.at(-1), false);
});

test("chapter controls stay hidden without usable chapters", () => {
  assert.equal(harness([]).empty(), true);
  assert.equal(harness([{ startSec: Infinity }]).empty(), true);
});
