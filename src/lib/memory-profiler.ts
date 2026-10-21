import { bridgeRows, resetBridgeStats } from "./fetch-bridge-stats";
import {
  buildDumpText,
  type DumpCapabilities,
  type DumpDrift,
  type RenderReportRow,
} from "./memory-dump-text";
import { getNativeMem, getRamTier } from "./native-memory";
import {
  probeRows,
  renderCauseRows,
  resetRenderCauses,
  setRenderCauseActive,
  storeNotifyRows,
} from "./render-cause";

type MemoryStats = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

declare global {
  interface Performance {
    memory?: MemoryStats;
  }
  interface Window {
    __compassProfiler?: ProfilerApi;
  }
}

export type SampleKind =
  | "tick"
  | "nav"
  | "fetch"
  | "click"
  | "mount"
  | "unmount"
  | "mark"
  | "warn"
  | "longtask"
  | "render"
  | "frame"
  | "loaf";

export type Sample = {
  ts: number;
  kind: SampleKind;
  label: string;
  heapMB: number;
  domNodes: number;
  imgs: number;
  vids: number;
  detail?: Record<string, unknown>;
};

export type CacheReport = { name: string; size: number };

/**
 * Frame pacing, sampled from a rAF loop while the profiler runs.
 *
 * This is the one signal the rest of the harness cannot infer: the long-task observer only sees
 * blocked script, and the tick-drift figure only notices a stall once it exceeds a whole second.
 * A frame that misses its budget while the main thread is otherwise idle is what a compositor or
 * fill-rate bound surface looks like, which is exactly the shape a bigger window makes worse.
 */
export type FrameSecond = {
  /** Seconds since the profiler started. */
  at: number;
  frames: number;
  p50: number;
  p95: number;
  max: number;
};

/** Median p95 across the first, middle and last third of the session — a degradation check. */
export type FrameTrend = {
  seconds: number;
  firstP95: number;
  midP95: number;
  lastP95: number;
};

export type FrameStats = {
  frames: number;
  /** Recent fps, from the median frame time of the sample buffer. */
  fps: number;
  /** Whole-session average. It hides hitches, so it is not the smoothness number. */
  sessionFps: number;
  /** 1% low: the fps of the slowest 1% of recent frames. This is the smoothness figure. */
  low1Fps: number;
  /** Estimated display refresh, from the fastest 5% of recent frames. */
  refreshHz: number;
  /** Per-frame budget in ms, derived from the display interval — 16.7 on 60Hz, 5.4 on 185Hz. */
  budgetMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames over 1.5x / 2.5x / 3.5x the budget, i.e. one, two and three dropped vsyncs. */
  missed: number;
  missed2: number;
  missed3: number;
  /** Frames in the sample buffer, so the miss counts can be read as a rate. */
  samples: number;
  windowSec: number;
  /** Worst seconds of the whole session, so an episode that ended before the dump still shows. */
  worstSeconds: FrameSecond[];
  trend: FrameTrend;
};

export type ViewportInfo = {
  dpr: number;
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
};

const MAX_SAMPLES = 600;
const TICK_INTERVAL_MS = 1000;
const REPORT_INTERVAL_MS = 5000;

const samples: Sample[] = [];
const fullHistory: Sample[] = [];
const listeners = new Set<() => void>();
const cacheGetters = new Map<string, () => number>();
const cacheSizeHistory = new Map<string, number[]>();
const navStack: { label: string; at: number; heap: number }[] = [];
let lastReportAt = 0;
let tickHandle: number | null = null;
let started = false;
// Instrumentation wraps window.fetch and installs observers, so it must run once for the life of
// the page. `started` flips back on stop, and dev StrictMode mounts the HUD twice, which used to
// wrap fetch again on the second start — doubling every sample and the wrapper's own overhead.
let instrumented = false;
let baselineHeapMB = 0;
let peakHeapMB = 0;
let networkBytes = 0;
let resetAt = 0;
let lastDumpAt = 0;
const FULL_HISTORY_MAX = 60_000;
const DRIFT_STALL_MS = 500;
let lastTickAt = 0;
let driftTicks = 0;
let maxDriftMs = 0;
let driftStalls = 0;
let hiddenTicks = 0;

const FRAME_BUFFER_MAX = 900;
const FRAME_STALL_MS = 100;
// Per-second history for the whole session. The 900-frame buffer above only covers the last few
// seconds, so a scrolling episode that ended before the dump was invisible — which is exactly how
// "it gets laggier while I scroll" kept reading as a clean 10%.
const SECOND_HISTORY_MAX = 3600;
let secondHistory: Array<{ at: number; frames: number; p50: number; p95: number; max: number }> = [];
let secondDts: number[] = [];
let secondStartAt = 0;
let frameRaf: number | null = null;
let frameBuffer: number[] = [];
let frameCount = 0;
let frameLoopStartedAt = 0;
let frameLastAt = 0;

function bytesToMB(b: number): number {
  return Math.round((b / 1024 / 1024) * 100) / 100;
}

function nowMs(): number {
  return performance.now();
}

function snapshotHeapMB(): number {
  const mem = performance.memory;
  if (!mem) return 0;
  return bytesToMB(mem.usedJSHeapSize);
}

function snapshotDom(): { nodes: number; imgs: number; vids: number } {
  if (typeof document === "undefined") return { nodes: 0, imgs: 0, vids: 0 };
  const nodes = document.getElementsByTagName("*").length;
  const imgs = document.images.length;
  const vids = document.getElementsByTagName("video").length;
  return { nodes, imgs, vids };
}

function pushSample(kind: SampleKind, label: string, detail?: Record<string, unknown>) {
  const heapMB = snapshotHeapMB();
  const dom = snapshotDom();
  const sample: Sample = {
    ts: Date.now(),
    kind,
    label,
    heapMB,
    domNodes: dom.nodes,
    imgs: dom.imgs,
    vids: dom.vids,
    detail,
  };
  samples.push(sample);
  fullHistory.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
  if (fullHistory.length > FULL_HISTORY_MAX) fullHistory.shift();
  if (heapMB > peakHeapMB) peakHeapMB = heapMB;
  if (baselineHeapMB === 0) baselineHeapMB = heapMB;
  listeners.forEach((fn) => fn());
}

export function getInstrumentationSupport(): DumpCapabilities {
  let longTasks = false;
  let loaf = false;
  try {
    const types = PerformanceObserver.supportedEntryTypes as string[] | undefined;
    longTasks = Array.isArray(types) && types.includes("longtask");
    loaf = Array.isArray(types) && types.includes("long-animation-frame");
  } catch {}
  return {
    jsHeap: typeof performance !== "undefined" && !!performance.memory,
    longTasks,
    loaf,
    nativeRss: getNativeMem().total > 0,
  };
}

function driftStats(): DumpDrift {
  return {
    ticks: driftTicks,
    maxDriftMs: Math.round(maxDriftMs),
    stalls: driftStalls,
    hiddenTicks,
  };
}

function noteTick(): void {
  const now = Date.now();
  const previous = lastTickAt;
  lastTickAt = now;
  if (previous === 0) return;
  if (typeof document !== "undefined" && document.hidden) {
    hiddenTicks += 1;
    return;
  }
  driftTicks += 1;
  const drift = now - previous - TICK_INTERVAL_MS;
  if (drift > maxDriftMs) maxDriftMs = drift;
  if (drift > DRIFT_STALL_MS) driftStalls += 1;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function startFrameLoop(): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return;
  if (frameRaf != null) return;
  frameLastAt = nowMs();
  frameLoopStartedAt = frameLastAt;
  const tick = (now: number) => {
    const dt = now - frameLastAt;
    frameLastAt = now;
    frameCount += 1;
    frameBuffer.push(dt);
    if (frameBuffer.length > FRAME_BUFFER_MAX) frameBuffer.shift();
    if (secondStartAt === 0) secondStartAt = now;
    secondDts.push(dt);
    if (now - secondStartAt >= TICK_INTERVAL_MS) {
      const sortedSecond = secondDts.slice().sort((a, b) => a - b);
      secondHistory.push({
        at: Math.round((secondStartAt - frameLoopStartedAt) / 1000),
        frames: secondDts.length,
        p50: Math.round(percentile(sortedSecond, 0.5) * 10) / 10,
        p95: Math.round(percentile(sortedSecond, 0.95) * 10) / 10,
        max: Math.round((sortedSecond[sortedSecond.length - 1] ?? 0) * 10) / 10,
      });
      if (secondHistory.length > SECOND_HISTORY_MAX) secondHistory.shift();
      secondDts = [];
      secondStartAt = now;
    }
    // A frame this long is a visible hitch worth one line in the timeline. Sampling the DOM and
    // heap for every frame instead would make the probe the thing being measured.
    if (dt > FRAME_STALL_MS)
      pushSample("frame", `${dt.toFixed(0)}ms frame`, { durationMs: Math.round(dt) });
    frameRaf = requestAnimationFrame(tick);
  };
  frameRaf = requestAnimationFrame(tick);
}

function stopFrameLoop(): void {
  if (frameRaf != null) {
    cancelAnimationFrame(frameRaf);
    frameRaf = null;
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function frameTrend(): FrameTrend {
  const p95s = secondHistory.map((s) => s.p95);
  if (p95s.length < 3) return { seconds: p95s.length, firstP95: 0, midP95: 0, lastP95: 0 };
  const third = Math.floor(p95s.length / 3);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    seconds: p95s.length,
    firstP95: round1(medianOf(p95s.slice(0, third))),
    midP95: round1(medianOf(p95s.slice(third, third * 2))),
    lastP95: round1(medianOf(p95s.slice(third * 2))),
  };
}

export function getFrameStats(): FrameStats {
  const sorted = frameBuffer.slice().sort((a, b) => a - b);
  const windowSec = frameLoopStartedAt ? (nowMs() - frameLoopStartedAt) / 1000 : 0;
  const p50 = percentile(sorted, 0.5);
  const p99 = percentile(sorted, 0.99);
  // The fastest frames approximate the display interval, so the budget is measured rather than
  // assumed. A hardcoded 16.7ms judged a 185Hz panel three times too leniently: every frame it
  // actually dropped still counted as on time.
  const intervalMs = percentile(sorted, 0.05);
  const toFps = (ms: number) => (ms > 0 ? Math.round((1000 / ms) * 10) / 10 : 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: frameCount,
    fps: toFps(p50),
    sessionFps: windowSec > 0 ? Math.round((frameCount / windowSec) * 10) / 10 : 0,
    low1Fps: toFps(p99),
    refreshHz: intervalMs > 0 ? Math.round(1000 / intervalMs) : 0,
    budgetMs: round1(intervalMs),
    p50Ms: round1(p50),
    p95Ms: round1(percentile(sorted, 0.95)),
    p99Ms: round1(p99),
    maxMs: round1(sorted[sorted.length - 1] ?? 0),
    missed: intervalMs > 0 ? frameBuffer.filter((v) => v > intervalMs * 1.5).length : 0,
    missed2: intervalMs > 0 ? frameBuffer.filter((v) => v > intervalMs * 2.5).length : 0,
    missed3: intervalMs > 0 ? frameBuffer.filter((v) => v > intervalMs * 3.5).length : 0,
    samples: frameBuffer.length,
    windowSec: Math.round(windowSec),
    worstSeconds: secondHistory
      .slice()
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 6),
    trend: frameTrend(),
  };
}

export function getViewportInfo(): ViewportInfo {
  if (typeof window === "undefined") {
    return { dpr: 0, width: 0, height: 0, screenWidth: 0, screenHeight: 0 };
  }
  return {
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    width: window.innerWidth,
    height: window.innerHeight,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
  };
}

function buildDump(): string {
  const now = Date.now();
  const sinceReset = resetAt || (fullHistory[0]?.ts ?? now);
  return buildDumpText({
    now,
    elapsedSec: (now - sinceReset) / 1000,
    baselineHeapMB,
    currentHeapMB: snapshotHeapMB(),
    peakHeapMB,
    dom: snapshotDom(),
    networkBytes,
    events: fullHistory.filter((s) => s.ts >= sinceReset),
    navStack,
    caches: reportCaches(),
    cacheHistory: cacheSizeHistory,
    renderReport: getRenderReport(),
    nativeMem: getNativeMem(),
    ramTier: getRamTier(),
    capabilities: getInstrumentationSupport(),
    drift: driftStats(),
    frames: getFrameStats(),
    viewport: getViewportInfo(),
    renderCauses: renderCauseRows(),
    storeNotifies: storeNotifyRows(),
    probes: probeRows(),
    bridges: bridgeRows(),
  });
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportCaches() {
  const out: CacheReport[] = [];
  for (const [name, getter] of cacheGetters) {
    try {
      const size = getter();
      out.push({ name, size });
      const history = cacheSizeHistory.get(name) ?? [];
      history.push(size);
      if (history.length > 60) history.shift();
      cacheSizeHistory.set(name, history);
    } catch {}
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function periodicReport() {
  const now = Date.now();
  if (now - lastReportAt < REPORT_INTERVAL_MS) return;
  lastReportAt = now;
  const heap = snapshotHeapMB();
  const dom = snapshotDom();
  const caches = reportCaches();
  const delta = heap - baselineHeapMB;
  const recent = samples.slice(-12);
  const heapJumps = recent
    .map((s, i) => (i === 0 ? null : { s, jump: s.heapMB - recent[i - 1].heapMB }))
    .filter((x): x is { s: Sample; jump: number } => !!x && x.jump > 5);

  console.groupCollapsed(
    `%c[profiler] heap ${heap}MB (Δ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} from ${baselineHeapMB}MB, peak ${peakHeapMB}MB) · dom ${dom.nodes} · imgs ${dom.imgs} · vids ${dom.vids} · net ${bytesToMB(networkBytes)}MB`,
    "color:#7eb6ff;font-weight:bold",
  );
  if (caches.length > 0) {
    console.table(caches.slice(0, 20));
  }
  if (heapJumps.length > 0) {
    console.warn("Heap jumps (>5MB) in last window:");
    for (const { s, jump } of heapJumps) {
      console.warn(`  +${jump.toFixed(1)}MB @ ${new Date(s.ts).toLocaleTimeString()} after ${s.kind}: ${s.label}`);
    }
  }
  if (navStack.length > 0) {
    const lastNav = navStack[navStack.length - 1];
    const since = (Date.now() - lastNav.at) / 1000;
    const heapDeltaSinceNav = heap - lastNav.heap;
    console.info(`Last nav: ${lastNav.label} (${since.toFixed(0)}s ago, Δ${heapDeltaSinceNav >= 0 ? "+" : ""}${heapDeltaSinceNav.toFixed(1)}MB since)`);
  }
  console.groupEnd();
}

function instrumentFetch() {
  if (typeof window === "undefined") return;
  const origFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const startHeap = snapshotHeapMB();
    const startTs = nowMs();
    try {
      const res = await origFetch(input as RequestInfo, init);
      const cl = Number(res.headers.get("content-length") ?? 0);
      if (cl > 0) networkBytes += cl;
      const elapsed = Math.round(nowMs() - startTs);
      const endHeap = snapshotHeapMB();
      const heapDelta = endHeap - startHeap;
      // The delta spans request start to completion, so a request that took eight seconds reports
      // eight seconds of unrelated app allocation as if the response caused it — which is how a
      // 136-byte SPARQL reply appeared to cost 43MB. Only trust it when the request was short.
      const deltaTrustworthy = elapsed < 1000;
      if ((deltaTrustworthy && heapDelta > 2) || cl > 256 * 1024 || elapsed > 1500) {
        pushSample("fetch", shortenUrl(url), {
          status: res.status,
          bytes: cl,
          elapsedMs: elapsed,
          heapDeltaMB: deltaTrustworthy ? heapDelta : null,
        });
      }
      return res;
    } catch (err) {
      pushSample("fetch", shortenUrl(url), { error: String(err) });
      throw err;
    }
  };
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    const path = u.pathname.length > 60 ? u.pathname.slice(0, 60) + "…" : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url.length > 80 ? url.slice(0, 80) + "…" : url;
  }
}

function instrumentClicks() {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const label = target.getAttribute("aria-label") ||
        target.textContent?.trim().slice(0, 40) ||
        target.tagName.toLowerCase();
      pushSample("click", label);
    },
    { capture: true, passive: true },
  );
}

function instrumentLongTasks() {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        pushSample("longtask", `${entry.duration.toFixed(0)}ms long task`, {
          durationMs: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {}
}

type LoafScript = {
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
  invokerType?: string;
  duration?: number;
};

type LoafEntry = PerformanceEntry & {
  renderStart?: number;
  styleAndLayoutStart?: number;
  blockingDuration?: number;
  scripts?: LoafScript[];
};

/**
 * Long-animation-frame timing splits a slow frame into script, style/layout and render/paint, and
 * names the scripts that ran. The longtask observer only says "the main thread blocked"; this says
 * whether a 33ms frame was JavaScript, a style recalc, or raster, and which function caused it —
 * which is the difference between fixing code and fixing paint.
 */
function instrumentLongAnimationFrames() {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  try {
    const types = PerformanceObserver.supportedEntryTypes as string[] | undefined;
    if (!Array.isArray(types) || !types.includes("long-animation-frame")) return;
    const observer = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const entry = raw as LoafEntry;
        if (entry.duration < 80) continue;
        const scriptMs = entry.renderStart ? Math.max(0, entry.renderStart - entry.startTime) : 0;
        const styleMs =
          entry.styleAndLayoutStart && entry.renderStart
            ? Math.max(0, entry.styleAndLayoutStart - entry.renderStart)
            : 0;
        const paintMs = entry.styleAndLayoutStart
          ? Math.max(0, entry.startTime + entry.duration - entry.styleAndLayoutStart)
          : 0;
        const scripts = (entry.scripts ?? [])
          .slice()
          .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
          .slice(0, 3)
          .map(
            (s) =>
              `${s.sourceFunctionName || s.invoker || s.invokerType || "?"} @${shortenUrl(s.sourceURL ?? "")} ${Math.round(s.duration ?? 0)}ms`,
          );
        pushSample(
          "loaf",
          `${entry.duration.toFixed(0)}ms frame — script ${scriptMs.toFixed(0)} style ${styleMs.toFixed(0)} paint ${paintMs.toFixed(0)}`,
          {
            durationMs: Math.round(entry.duration),
            scriptMs: Math.round(scriptMs),
            styleMs: Math.round(styleMs),
            paintMs: Math.round(paintMs),
            blockingMs: Math.round(entry.blockingDuration ?? 0),
            scripts,
          },
        );
      }
    });
    observer.observe({ entryTypes: ["long-animation-frame"] });
  } catch {}
}

const renderTimings = new Map<string, { count: number; totalMs: number; maxMs: number; lastMs: number }>();

export function recordRender(componentId: string, actualDurationMs: number): void {
  const entry = renderTimings.get(componentId) ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  entry.count += 1;
  entry.totalMs += actualDurationMs;
  entry.lastMs = actualDurationMs;
  if (actualDurationMs > entry.maxMs) entry.maxMs = actualDurationMs;
  renderTimings.set(componentId, entry);
  if (actualDurationMs > 16) {
    pushSample("render", `${componentId} ${actualDurationMs.toFixed(1)}ms`, {
      componentId,
      durationMs: Math.round(actualDurationMs * 10) / 10,
    });
  }
}

export function getRenderReport(): RenderReportRow[] {
  const out: RenderReportRow[] = [];
  for (const [id, t] of renderTimings) {
    out.push({
      id,
      count: t.count,
      totalMs: Math.round(t.totalMs * 10) / 10,
      maxMs: Math.round(t.maxMs * 10) / 10,
      avgMs: Math.round((t.totalMs / t.count) * 10) / 10,
      lastMs: Math.round(t.lastMs * 10) / 10,
    });
  }
  out.sort((a, b) => b.totalMs - a.totalMs);
  return out;
}

type ProfilerApi = {
  start: () => void;
  stop: () => void;
  mark: (label: string, detail?: Record<string, unknown>) => void;
  recordNav: (label: string) => void;
  registerCache: (name: string, getter: () => number) => void;
  unregisterCache: (name: string) => void;
  getSamples: () => Sample[];
  getCacheReports: () => CacheReport[];
  getCacheHistory: () => Map<string, number[]>;
  getHeapMB: () => number;
  getBaselineMB: () => number;
  getPeakMB: () => number;
  getNetworkMB: () => number;
  reset: () => void;
  subscribe: (fn: () => void) => () => void;
  dumpReport: () => { filename: string; bytes: number; events: number };
};

export function startProfiler(): void {
  if (started) return;
  started = true;
  baselineHeapMB = snapshotHeapMB();
  peakHeapMB = baselineHeapMB;
  resetAt = Date.now();
  pushSample("mark", "profiler:start");
  if (!instrumented) {
    instrumented = true;
    instrumentFetch();
    instrumentClicks();
    instrumentLongTasks();
    instrumentLongAnimationFrames();
  }
  startFrameLoop();
  setRenderCauseActive(true);
  if (typeof window !== "undefined") {
    lastTickAt = Date.now();
    tickHandle = window.setInterval(() => {
      noteTick();
      pushSample("tick", "interval");
      periodicReport();
    }, TICK_INTERVAL_MS);
  }
  console.info(
    `%c[profiler] started — baseline ${baselineHeapMB}MB. Console reports every ${REPORT_INTERVAL_MS / 1000}s. Call window.__compassProfiler.dumpReport() for instant snapshot.`,
    "color:#7eb6ff;font-weight:bold",
  );
}

export function stopProfiler(): void {
  if (!started) return;
  started = false;
  stopFrameLoop();
  setRenderCauseActive(false);
  if (tickHandle != null) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

export function markEvent(label: string, detail?: Record<string, unknown>): void {
  pushSample("mark", label, detail);
}

/** Whether the profiler is collecting. Lets the React Profiler wrapper stay inert until it is. */
export function isProfilerRunning(): boolean {
  return started;
}

export function recordNav(label: string): void {
  const heap = snapshotHeapMB();
  navStack.push({ label, at: Date.now(), heap });
  if (navStack.length > 20) navStack.shift();
  pushSample("nav", label, { heapMB: heap });
}

export function registerCache(name: string, getter: () => number): void {
  cacheGetters.set(name, getter);
}

export function unregisterCache(name: string): void {
  cacheGetters.delete(name);
  cacheSizeHistory.delete(name);
}

export function getSamples(): Sample[] {
  return samples.slice();
}

export function getCacheReports(): CacheReport[] {
  return reportCaches();
}

export function subscribeProfiler(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function dumpReport(): { filename: string; bytes: number; events: number } {
  const text = buildDump();
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}`;
  const filename = `compass-profile-${stamp}.txt`;
  downloadText(text, filename);
  lastDumpAt = Date.now();
  const sinceReset = resetAt || (fullHistory[0]?.ts ?? Date.now());
  const events = fullHistory.filter((s) => s.ts >= sinceReset).length;
  console.info(
    `%c[profiler] dumped ${filename} (${(text.length / 1024).toFixed(1)} KB, ${events} events). Check your Downloads folder.`,
    "color:#7eb6ff;font-weight:bold;font-size:14px",
  );
  listeners.forEach((fn) => fn());
  return { filename, bytes: text.length, events };
}

export function getLastDumpAt(): number {
  return lastDumpAt;
}

const api: ProfilerApi = {
  start: startProfiler,
  stop: stopProfiler,
  mark: markEvent,
  recordNav,
  registerCache,
  unregisterCache,
  getSamples,
  getCacheReports,
  getCacheHistory: () => cacheSizeHistory,
  getHeapMB: snapshotHeapMB,
  getBaselineMB: () => baselineHeapMB,
  getPeakMB: () => peakHeapMB,
  getNetworkMB: () => bytesToMB(networkBytes),
  reset: () => {
    samples.length = 0;
    fullHistory.length = 0;
    navStack.length = 0;
    renderTimings.clear();
    baselineHeapMB = snapshotHeapMB();
    peakHeapMB = baselineHeapMB;
    networkBytes = 0;
    resetAt = Date.now();
    resetBridgeStats();
    lastTickAt = Date.now();
    driftTicks = 0;
    maxDriftMs = 0;
    driftStalls = 0;
    hiddenTicks = 0;
    frameBuffer = [];
    frameCount = 0;
    secondHistory = [];
    secondDts = [];
    secondStartAt = 0;
    frameLoopStartedAt = nowMs();
    frameLastAt = frameLoopStartedAt;
    resetRenderCauses();
    pushSample("mark", "profiler:reset");
  },
  subscribe: subscribeProfiler,
  dumpReport,
};

if (typeof window !== "undefined") {
  window.__compassProfiler = api;
}
