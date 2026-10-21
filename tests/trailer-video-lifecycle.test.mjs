import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = new Map();
function evaluate(file, resolve, document, window) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(
      readFileSync(new URL("../src/lib/" + file, import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText);
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", "document", "window", compiled.get(file))(
    resolve, module, module.exports, document, window,
  );
  return module.exports;
}

class FakeNode {
  style = { opacity: "", cssText: "" };
  isConnected = true;
  parentElement = null;
  attrs = new Map();
  listeners = new Map();
  muted = false;
  volume = 1;
  readyState = 0;
  paused = true;
  plays = 0;
  playResults = [];
  appendChild(child) { child.parentElement = this; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  set src(value) { this.attrs.set("src", value); this.readyState = 0; }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  dispatch(name) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(); }
  pause() { this.paused = true; }
  load() { this.readyState = 0; }
  play() {
    this.plays += 1;
    this.paused = false;
    return this.playResults.shift()?.() ?? Promise.resolve();
  }
}

function environment() {
  let nextTimer = 0;
  const timers = new Map();
  const document = { body: new FakeNode(), createElement: () => new FakeNode() };
  const window = {
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  const pool = evaluate("trailer-video.ts", () => { throw new Error("Unexpected import"); }, document, window);
  return {
    document, window, pool,
    assignSource() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== 120) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

// Run the real hook with deterministic effects, media events, and playback promises.
function renderer(env) {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let pending = [];
  let props;
  let output;
  const mount = new FakeNode();
  const react = {
    useRef(value) {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    useState(value) {
      const index = cursor++;
      const slot = slots[index] ??= { value };
      return [slot.value, next => {
        if (Object.is(next, slot.value)) return;
        slot.value = next;
        dirty = true;
      }];
    },
    useEffect(run, deps) {
      const index = cursor++;
      const slot = slots[index] ??= {};
      if (slot.deps && deps.every((value, i) => Object.is(value, slot.deps[i]))) return;
      slot.deps = deps;
      pending.push({ slot, run });
    },
  };
  const { useTrailerVideo } = evaluate("use-trailer-video.ts", name => {
    if (name === "react") return react;
    if (name === "@/lib/trailer-video") return env.pool;
    throw new Error("Unexpected import: " + name);
  }, env.document, env.window);
  const api = {
    render(next) { props = next; dirty = true; return api.flush(); },
    flush() {
      let passes = 0;
      while (dirty) {
        assert.ok(++passes < 20, "effects should settle");
        dirty = false;
        cursor = 0;
        pending = [];
        output = useTrailerVideo(props);
        output.slot.current = mount;
        for (const { slot } of pending) slot.cleanup?.();
        for (const { slot, run } of pending) slot.cleanup = run();
      }
      return output;
    },
  };
  return api;
}

const defaults = { src: "trailer-a", active: true, playing: true, muted: false, className: "video", loop: true };
function start(env, view, options = {}) {
  let result = view.render({ ...defaults, ...options });
  env.assignSource();
  const node = result.video.current;
  node.readyState = 4;
  node.dispatch("canplay");
  result = view.flush();
  return { node, result };
}

test("claiming a parked video restores visibility and pauses the previous playback", () => {
  const { pool } = environment();
  const home = {};
  const detail = {};
  const node = pool.claimTrailerVideo(home, new FakeNode());
  assert.equal(node.style.opacity, "");
  node.paused = false;
  pool.releaseTrailerVideo(home);
  assert.equal(node.style.opacity, "0");
  const reused = pool.claimTrailerVideo(detail, new FakeNode());
  assert.equal(reused, node);
  assert.equal(reused.style.opacity, "");
  assert.equal(reused.paused, true);
  pool.releaseTrailerVideo(home);
  assert.equal(pool.trailerVideoHeldBy(detail), true);
});

test("the previous source cannot make a newly claimed trailer ready or start it early", () => {
  const env = environment();
  const previous = {};
  const node = env.pool.claimTrailerVideo(previous, new FakeNode());
  node.src = "previous-trailer";
  node.readyState = 4;
  env.pool.releaseTrailerVideo(previous);
  const view = renderer(env);
  assert.equal(view.render(defaults).ready, false);
  node.dispatch("canplay");
  assert.equal(view.flush().ready, false);
  assert.equal(node.plays, 0);
  env.assignSource();
  node.dispatch("canplay");
  assert.equal(view.flush().ready, false);
  node.readyState = 4;
  node.dispatch("canplay");
  assert.equal(view.flush().ready, true);
  assert.equal(node.plays, 1);
});

test("overview playback restores volume after a muted home trailer and reactivation", () => {
  const env = environment();
  const home = renderer(env);
  const { node } = start(env, home, { muted: true, volume: 0 });
  home.render({ ...defaults, active: false, muted: true, volume: 0 });
  const detail = renderer(env);
  assert.equal(detail.render({ ...defaults, volume: 1 }).ready, true);
  assert.equal(node.volume, 1);
  assert.equal(node.muted, false);
  assert.equal(node.paused, false);
  detail.render({ ...defaults, active: false });
  home.render({ ...defaults, muted: true, volume: 0 });
  assert.equal(node.volume, 0);
  assert.equal(node.muted, true);
  assert.equal(node.style.opacity, "");
});

test("a source change hides the old trailer until the requested video becomes ready", () => {
  const env = environment();
  const view = renderer(env);
  const { node } = start(env, view);
  const plays = node.plays;
  assert.equal(view.render({ ...defaults, src: "trailer-b" }).ready, false);
  node.dispatch("canplay");
  assert.equal(view.flush().ready, false);
  assert.equal(node.plays, plays);
  env.assignSource();
  node.readyState = 4;
  node.dispatch("canplay");
  assert.equal(view.flush().ready, true);
  assert.equal(node.plays, plays + 1);
});

for (const name of ["AbortError", "NotAllowedError"]) {
  test(name + " only mutes and retries when autoplay permission was denied", async () => {
    const env = environment();
    const view = renderer(env);
    let fallback = 0;
    const result = view.render({ ...defaults, onAutoplayMuted: () => { fallback += 1; } });
    env.assignSource();
    const node = result.video.current;
    node.playResults.push(() => Promise.reject({ name }));
    node.readyState = 4;
    node.dispatch("canplay");
    view.flush();
    await Promise.resolve();
    assert.equal(fallback, name === "NotAllowedError" ? 1 : 0);
    assert.equal(node.muted, name === "NotAllowedError");
    assert.equal(node.plays, name === "NotAllowedError" ? 2 : 1);
  });
}

test("a late playback rejection cannot mute or retry after another owner takes over", async () => {
  const env = environment();
  const home = renderer(env);
  let rejectPlay;
  let fallback = 0;
  const options = { ...defaults, onAutoplayMuted: () => { fallback += 1; } };
  const result = home.render(options);
  env.assignSource();
  const node = result.video.current;
  node.playResults.push(() => new Promise((resolve, reject) => { rejectPlay = reject; }));
  node.readyState = 4;
  node.dispatch("canplay");
  home.flush();
  const detail = renderer(env);
  detail.render(defaults);
  const plays = node.plays;
  rejectPlay({ name: "NotAllowedError" });
  await Promise.resolve();
  assert.equal(fallback, 0);
  assert.equal(node.muted, false);
  assert.equal(node.plays, plays);
});

test("a late playback rejection is ignored after pausing the same owner", async () => {
  const env = environment();
  const view = renderer(env);
  let rejectPlay;
  let fallback = 0;
  const options = { ...defaults, onAutoplayMuted: () => { fallback += 1; } };
  const result = view.render(options);
  env.assignSource();
  const node = result.video.current;
  node.playResults.push(() => new Promise((resolve, reject) => { rejectPlay = reject; }));
  node.readyState = 4;
  node.dispatch("canplay");
  view.flush();
  view.render({ ...options, playing: false });
  rejectPlay({ name: "NotAllowedError" });
  await Promise.resolve();
  assert.equal(fallback, 0);
  assert.equal(node.muted, false);
  assert.equal(node.paused, true);
  assert.equal(node.plays, 1);
});


test("scroll volume updates do not restart playback", () => {
  const env = environment();
  const view = renderer(env);
  const { node } = start(env, view, { volume: 0.5 });
  const plays = node.plays;
  view.render({ ...defaults, volume: 0.2 });
  assert.equal(node.volume, 0.2);
  assert.equal(node.plays, plays);
  assert.equal(node.paused, false);
});

test("hiding the page cancels a pending source assignment", () => {
  const env = environment();
  const view = renderer(env);
  const result = view.render(defaults);
  const node = result.video.current;
  view.render({ ...defaults, active: false });
  env.assignSource();
  node.readyState = 4;
  node.dispatch("canplay");
  assert.equal(view.flush().ready, false);
  assert.equal(node.getAttribute("src"), null);
  assert.equal(node.plays, 0);
  assert.equal(node.paused, true);
});
