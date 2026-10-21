import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import ts from "typescript";
import type { MangaFavoritesStore } from "../src/lib/manga-favorites";

const key = (profile: string) => `compass.mangafav.v1.${profile}`;
const original = {
  id: "old",
  title: "Old title",
  altTitle: "原題",
  cover: "https://fixture.invalid/old.png",
  addedAt: 5,
};

async function fixture() {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let profile = "one";
  let storageOk = true;
  localStorage.setItem(key(profile), JSON.stringify([original]));
  const writes: unknown[][] = [];
  const code = ts.transpileModule(
    readFileSync(new URL("../src/lib/manga-favorites.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "./profiles": { useProfiles: () => ({ activeId: profile }) },
    "./storage-recovery": {
      setItemWithRecovery(name: string, value: string) {
        if (storageOk) localStorage.setItem(name, value);
        return storageOk;
      },
    },
    "./manga/api": {
      setMangaInLibrary: async (...args: unknown[]) => {
        writes.push(args);
        return true;
      },
    },
    "./manga/library-events": { notifyMangaLibraryChanged() {} },
    "./manga/sources": {
      activeMangaSourceId: () => "unrelated",
      listMangaSources: () => [
        { id: "alpha", kind: "suwayomi", baseUrl: "https://fixture.invalid/alpha" },
      ],
    },
  };
  const module = { exports: {} as typeof import("../src/lib/manga-favorites") };
  new Function("require", "module", "exports", code)(
    (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
  );
  let store: MangaFavoritesStore;
  function Consumer() {
    store = module.exports.useMangaFavorites();
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  async function render() {
    await React.act(async () => {
      root.render(
        React.createElement(
          module.exports.MangaFavoritesProvider,
          null,
          React.createElement(Consumer),
        ),
      );
    });
  }
  await render();
  return {
    store: () => store!,
    writes,
    failStorage() {
      storageOk = false;
    },
    async switchProfile() {
      profile = "two";
      await render();
    },
    async close() {
      await React.act(() => root.unmount());
      dom.window.close();
    },
  };
}

test("favorite repair persists exact resolved metadata and provider identity before publishing state", async () => {
  const f = await fixture();
  try {
    await React.act(async () => {
      f.store().repair("old", {
        id: "alpha::live",
        title: "Current title",
        altTitle: "新題",
        cover: "https://fixture.invalid/live.png",
      });
    });
    const persisted = JSON.parse(localStorage.getItem(key("one"))!);
    assert.deepEqual(persisted, [
      {
        ...original,
        id: "alpha::live",
        title: "Current title",
        altTitle: "新題",
        cover: "https://fixture.invalid/live.png",
        sourceId: "alpha",
      },
    ]);
    assert.equal(f.store().has("alpha::live"), true);
    assert.equal(f.store().items.has("old"), false);
    assert.deepEqual(f.writes, [["alpha::live", true, "alpha", "https://fixture.invalid/alpha"]]);
  } finally {
    await f.close();
  }
});

test("a failed repair leaves the durable favorite and its in-memory identity intact", async () => {
  const f = await fixture();
  try {
    f.failStorage();
    await React.act(async () => {
      f.store().repair("old", { id: "alpha::live", title: "Current title" });
    });
    assert.deepEqual(JSON.parse(localStorage.getItem(key("one"))!), [original]);
    assert.deepEqual([...f.store().items.values()], [{ ...original, sourceId: undefined }]);
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});

test("a delayed old-profile repair cannot rewrite either profile after a switch", async () => {
  const f = await fixture();
  try {
    const staleStore = f.store();
    await f.switchProfile();
    await React.act(async () => {
      staleStore.repair("old", { id: "alpha::live", title: "Current title" });
    });
    assert.deepEqual(JSON.parse(localStorage.getItem(key("one"))!), [original]);
    assert.equal(localStorage.getItem(key("two")), null);
    assert.equal(f.store().count, 0);
    assert.deepEqual(f.writes, []);
  } finally {
    await f.close();
  }
});
