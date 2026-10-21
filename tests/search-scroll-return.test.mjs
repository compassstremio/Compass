import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function searchHarness() {
  const refs = [],
    states = [],
    deps = [];
  let ri, si, ei, pending;
  const state = { open: true, mounted: true, closing: false, query: "ozark", profile: "first" };
  const mocks = {
    react: {
      lazy: () => () => null,
      useEffect: () => {},
      useLayoutEffect: (run, next) => {
        const index = ei++;
        if (!deps[index] || next.some((value, n) => !Object.is(value, deps[index][n]))) {
          deps[index] = next;
          pending.push(run);
        }
      },
      useRef: (value) => (refs[ri++] ??= { current: value }),
      useState: (value) => {
        const index = si++;
        if (!(index in states)) states[index] = value;
        return [
          states[index],
          (next) => {
            states[index] = next;
          },
        ];
      },
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-dom": { createPortal: (tree) => tree },
    "@/lib/search-context": { useSearch: () => ({ ...state, results: null, status: "idle" }) },
    "@/lib/view": { useView: () => ({}) },
    "@/lib/i18n": { useT: () => (text) => text },
    "@/lib/settings": { useSettings: () => ({ settings: { aiSearchKey: "", aiGroqKey: "" } }) },
    "@/lib/profiles": { useProfiles: () => ({ activeProfile: { id: state.profile } }) },
    "@/lib/use-exit-presence": { useExitPresence: () => state },
    "@/lib/use-window-fullscreen": { useWindowFullscreen: () => false },
    "@/lib/games/steam-store-search": { steamStoreQuery: () => null },
    "./use-collection-hits": { useCollectionHits: () => [] },
    "./person-top-match": { matchPersonForQuery: () => null },
    "@/lib/search-display-state": { getSearchDisplayState: () => ({ currentResults: null }) },
    "@/lib/torrent/magnet": { isMagnetInput: () => false, isDirectVideoUrl: () => false },
  };
  const source = readFileSync(
    new URL("../src/components/search/search-overlay.tsx", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "document", code)((name) => mocks[name] ?? {}, exports, {
    body: {},
  });
  function body(node) {
    if (!node || typeof node !== "object") return null;
    if (node.props?.className?.startsWith("compass-search-body")) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = body(child);
      if (found) return found;
    }
    return null;
  }
  let element;
  return {
    state,
    render() {
      ri = si = ei = 0;
      pending = [];
      const node = body(exports.SearchOverlay());
      if (node) {
        element ??= { scrollTop: 0 };
        node.props.ref.current = element;
      } else {
        element = null;
        refs[2].current = null;
      }
      for (const run of pending) run();
      return node
        ? {
            element,
            scroll: (top) => {
              element.scrollTop = top;
              node.props.onScroll({ currentTarget: element });
            },
          }
        : null;
    },
  };
}

test("search restores its scroll after the panel unmounts on close or title navigation", () => {
  for (const reason of ["close", "title navigation"]) {
    const h = searchHarness();
    h.render().scroll(1400);
    h.state.open = false;
    h.state.closing = true;
    h.render().scroll(0);
    h.state.mounted = false;
    h.state.closing = false;
    assert.equal(h.render(), null, reason);
    h.state.open = h.state.mounted = true;
    assert.equal(h.render().element.scrollTop, 1400, reason);
  }
});

test("a new query or profile cannot inherit another search position", () => {
  const h = searchHarness();
  h.render().scroll(1400);
  h.state.query = "different";
  assert.equal(h.render().element.scrollTop, 0);
  h.render().scroll(700);
  h.state.profile = "second";
  assert.equal(h.render().element.scrollTop, 0);
});
