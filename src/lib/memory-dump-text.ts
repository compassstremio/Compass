import { formatBridgeSection, type BridgeRow } from "./fetch-bridge-stats";
import type { CacheReport, FrameStats, Sample, ViewportInfo } from "./memory-profiler";

export type DumpCapabilities = {
  jsHeap: boolean;
  longTasks: boolean;
  loaf?: boolean;
  nativeRss: boolean;
};

export type DumpDrift = {
  ticks: number;
  maxDriftMs: number;
  stalls: number;
  hiddenTicks: number;
};

export type RenderReportRow = {
  id: string;
  count: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
  lastMs: number;
};

export type DumpInput = {
  now: number;
  elapsedSec: number;
  baselineHeapMB: number;
  currentHeapMB: number;
  peakHeapMB: number;
  dom: { nodes: number; imgs: number; vids: number };
  networkBytes: number;
  events: Sample[];
  navStack: { label: string; at: number; heap: number }[];
  caches: CacheReport[];
  cacheHistory: Map<string, number[]>;
  renderReport: RenderReportRow[];
  nativeMem: { compassRss: number; webviewRss: number; total: number };
  ramTier: string;
  capabilities: DumpCapabilities;
  drift: DumpDrift;
  frames?: FrameStats;
  viewport?: ViewportInfo;
  renderCauses?: Array<{ component: string; causes: Array<{ label: string; count: number }> }>;
  storeNotifies?: Array<{ label: string; count: number }>;
  probes?: Array<{ label: string; count: number }>;
  bridges: BridgeRow[];
};

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function formatLineNumber(n: number, width = 4): string {
  return String(n).padStart(width, " ");
}

function formatMB(mb: number, width = 7): string {
  return `${mb.toFixed(1).padStart(width - 2, " ")}MB`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString("en-GB")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function heapLines(input: DumpInput): string[] {
  if (!input.capabilities.jsHeap) {
    return [
      "  js heap:       unavailable on this webview, performance.memory is not implemented",
      "  heap history:  not collected, every heap figure below reads 0.0 MB",
    ];
  }
  const delta = input.currentHeapMB - input.baselineHeapMB;
  return [
    `  baseline heap: ${input.baselineHeapMB.toFixed(1)} MB`,
    `  current heap:  ${input.currentHeapMB.toFixed(1)} MB`,
    `  peak heap:     ${input.peakHeapMB.toFixed(1)} MB`,
    `  delta:         ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} MB`,
  ];
}

function rssLine(input: DumpInput): string {
  const { compassRss, webviewRss, total } = input.nativeMem;
  if (total <= 0) return "  native rss:    unavailable on this platform build";
  const webview =
    webviewRss > 0
      ? `webview ${webviewRss.toFixed(0)}`
      : "webview not attributed on this platform";
  return `  native rss:    ${total.toFixed(0)} MB (app ${compassRss.toFixed(0)}, ${webview}) tier ${input.ramTier}`;
}

function instrumentationSection(input: DumpInput): string[] {
  const { capabilities: caps, drift } = input;
  const lines: string[] = [];
  lines.push("PLATFORM INSTRUMENTATION (read this before trusting a zero above)");
  lines.push(`  performance.memory:      ${caps.jsHeap ? "available" : "MISSING"}`);
  lines.push(`  longtask observer:       ${caps.longTasks ? "available" : "MISSING"}`);
  lines.push(`  long-frame observer:     ${caps.loaf ? "available" : "MISSING"}`);
  lines.push(`  native rss command:      ${caps.nativeRss ? "available" : "MISSING"}`);
  lines.push(
    `  webview timer drift:     ${drift.ticks} ticks, max ${drift.maxDriftMs}ms, ${drift.stalls} over 500ms, ${drift.hiddenTicks} skipped while hidden`,
  );
  lines.push(
    "  how to read it: high bridge latency with low timer drift means the webview was healthy and",
  );
  lines.push(
    "  the stall was on the native side or in the IPC. High drift means the webview itself blocked.",
  );
  return lines;
}

function framesSection(input: DumpInput): string[] {
  const lines: string[] = [];
  lines.push("FRAME TIMING (rAF sampling while the profiler runs)");
  const vp = input.viewport;
  if (vp) {
    const backingW = Math.round(vp.width * vp.dpr);
    const backingH = Math.round(vp.height * vp.dpr);
    lines.push(
      `  viewport:      ${vp.width}x${vp.height} css · dpr ${vp.dpr} · backing ${backingW}x${backingH} px`,
    );
    if (vp.screenWidth) lines.push(`  screen:        ${vp.screenWidth}x${vp.screenHeight}`);
  }
  const f = input.frames;
  if (!f || f.frames === 0) {
    lines.push("  (no frames sampled, the profiler was not running or the window was hidden)");
    return lines;
  }
  const missRate = f.samples > 0 ? Math.round((f.missed / f.samples) * 1000) / 10 : 0;
  const at = (mult: number) => Math.round(f.budgetMs * mult * 10) / 10;
  lines.push(
    `  fps:           ${f.fps} recent (p50) · ${f.low1Fps} 1% low · ${f.sessionFps} session average`,
  );
  lines.push(`  refresh:       ~${f.refreshHz}Hz — budget ${f.budgetMs}ms per frame`);
  lines.push(
    `  frame time:    p50 ${f.p50Ms}ms · p95 ${f.p95Ms}ms · p99 ${f.p99Ms}ms · max ${f.maxMs}ms over ${f.windowSec}s (${f.frames} frames)`,
  );
  lines.push(
    `  missed budget: ${f.missed}/${f.samples} (${missRate}%) over ${at(1.5)}ms · ${f.missed2} over ${at(2.5)}ms · ${f.missed3} over ${at(3.5)}ms`,
  );
  if (f.trend && f.trend.seconds >= 3) {
    lines.push(
      `  session trend: median p95 by third — first ${f.trend.firstP95}ms · middle ${f.trend.midP95}ms · last ${f.trend.lastP95}ms (over ${f.trend.seconds}s)`,
    );
  }
  if (f.worstSeconds && f.worstSeconds.length > 0) {
    lines.push(
      "  worst seconds of the whole session (so an episode that ended before the dump still shows):",
    );
    for (const s of f.worstSeconds) {
      lines.push(`    +${s.at}s  p95 ${s.p95}ms · max ${s.max}ms · ${s.frames} frames`);
    }
  }
  lines.push(
    "  how to read it: the budget is derived from the display, so a 185Hz panel is judged at ~5.4ms, not",
  );
  lines.push(
    "  the 16.7ms of a 60Hz one. Judge smoothness by the miss rate and the 1% low, not the average — a",
  );
  lines.push(
    "  high average fps still hides a tail. A long p99 with a low max and no long tasks means fill-rate",
  );
  lines.push(
    "  or compositor cost, which scales with the backing pixels above, not JS.",
  );
  return lines;
}

/**
 * The frame-timing section says how big the slow frames were; this says what ran inside them. The
 * LoAF observer has always captured the scripts, but the dump only printed the frame total, so a
 * 658ms script frame was unattributable — and a render profiler cannot explain script time that
 * isn't React rendering.
 */
function slowFramesSection(input: DumpInput): string[] {
  const lines: string[] = [];
  const loaves = input.events.filter((e) => e.kind === "loaf" && e.detail);
  if (loaves.length === 0) return lines;
  const rows = loaves
    .map((e) => ({ e, ms: Number(e.detail?.durationMs ?? 0) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 12);
  lines.push("SLOW FRAMES (long-animation-frame, with the scripts that ran)");
  for (const { e, ms } of rows) {
    const d = e.detail ?? {};
    lines.push(
      `  ${formatTime(e.ts)}  ${String(Math.round(ms)).padStart(4)}ms  script ${String(d.scriptMs ?? "?")} style ${String(d.styleMs ?? "?")} paint ${String(d.paintMs ?? "?")} blocking ${String(d.blockingMs ?? "?")}`,
    );
    const scripts = Array.isArray(d.scripts) ? (d.scripts as string[]) : [];
    if (scripts.length === 0) lines.push("        (no script attribution reported)");
    for (const s of scripts) lines.push(`        ${s}`);
  }
  return lines;
}

function causeSection(input: DumpInput): string[] {
  const lines: string[] = [];
  lines.push("STORE NOTIFICATIONS (how often each store fired its listeners)");
  const notifies = input.storeNotifies ?? [];
  for (const n of notifies) {
    lines.push(`  ${String(n.count).padStart(6, " ")}  ${n.label}`);
  }
  if (notifies.length === 0) lines.push("  (none, or the probe was not running)");
  lines.push("");

  lines.push("RENDER CAUSES (which input changed on each re-render of a tracked component)");
  const rows = input.renderCauses ?? [];
  for (const row of rows) {
    const total = row.causes.reduce((n, c) => n + c.count, 0);
    lines.push(`  ${row.component} — ${total} renders`);
    for (const c of row.causes) {
      lines.push(`      ${String(c.count).padStart(6, " ")}  ${c.label}`);
    }
  }
  if (rows.length === 0) {
    lines.push("  (no tracked component reported, or the probe was not running)");
  }
  lines.push("");

  lines.push("EVENT COUNTERS (non-render events that are known to produce renders)");
  const probes = input.probes ?? [];
  for (const p of probes) {
    lines.push(`  ${String(p.count).padStart(6, " ")}  ${p.label}`);
  }
  if (probes.length === 0) lines.push("  (none, or the probe was not running)");
  return lines;
}

export function buildDumpText(input: DumpInput): string {
  const lines: string[] = [];
  lines.push("==========================================================");
  lines.push("  COMPASS MEMORY PROFILE DUMP");
  lines.push(`  Dumped at: ${new Date(input.now).toLocaleString()}`);
  lines.push(`  Window: last ${input.elapsedSec.toFixed(1)}s since reset`);
  lines.push("==========================================================");
  lines.push("");
  lines.push("SUMMARY");
  for (const line of heapLines(input)) lines.push(line);
  lines.push(`  dom nodes:     ${input.dom.nodes}`);
  lines.push(`  images:        ${input.dom.imgs}`);
  lines.push(`  videos:        ${input.dom.vids}`);
  lines.push(`  net downloaded: ${toMB(input.networkBytes).toFixed(2)} MB`);
  lines.push(`  total events:  ${input.events.length}`);
  lines.push(rssLine(input));
  lines.push("");

  for (const line of instrumentationSection(input)) lines.push(line);
  lines.push("");

  for (const line of framesSection(input)) lines.push(line);
  lines.push("");

  for (const line of slowFramesSection(input)) lines.push(line);
  lines.push("");

  for (const line of causeSection(input)) lines.push(line);
  lines.push("");

  lines.push("TOP MEMORY JUMPS (>3MB between consecutive events)");
  lines.push("  #  time         delta    heap     kind     label");
  let prev: Sample | null = null;
  let jumpCount = 0;
  for (const s of input.events) {
    if (prev) {
      const delta = s.heapMB - prev.heapMB;
      if (delta > 3) {
        jumpCount += 1;
        lines.push(
          `  ${formatLineNumber(jumpCount, 3)} ${formatTime(s.ts)}  +${delta.toFixed(1)}MB  ${formatMB(s.heapMB)}  [${s.kind.padEnd(7)}] ${s.label}`,
        );
      }
    }
    prev = s;
  }
  if (jumpCount === 0) {
    lines.push(
      input.capabilities.jsHeap
        ? "  (none, no individual event jumped >3MB)"
        : "  (cannot be measured, this webview reports no heap size)",
    );
  }
  lines.push("");

  lines.push("NAVIGATION TIMELINE");
  lines.push("  time         delta-since-nav  heap-at-nav   route");
  for (let i = 0; i < input.navStack.length; i++) {
    const n = input.navStack[i];
    const next = input.navStack[i + 1];
    const endHeap = next ? next.heap : input.currentHeapMB;
    const delta = endHeap - n.heap;
    lines.push(
      `  ${formatTime(n.at)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(1).padStart(5, " ")}MB        ${formatMB(n.heap)}     ${n.label}`,
    );
  }
  if (input.navStack.length === 0) lines.push("  (no navigations)");
  lines.push("");

  lines.push("CACHE SIZES (sorted)");
  lines.push("  size   name");
  for (const c of input.caches) {
    lines.push(`  ${formatLineNumber(c.size, 5)}  ${c.name}`);
  }
  lines.push("");

  lines.push("CACHE GROWTH (last 60 samples per cache)");
  for (const [name, history] of input.cacheHistory) {
    if (history.length < 2) continue;
    const start = history[0];
    const end = history[history.length - 1];
    const max = Math.max(...history);
    const arrow = end > start ? "up" : end < start ? "down" : "flat";
    lines.push(
      `  ${arrow.padEnd(4)} ${name.padEnd(30)} start=${start} end=${end} max=${max} samples=${history.length}`,
    );
  }
  lines.push("");

  for (const line of formatBridgeSection(input.bridges)) lines.push(line);
  lines.push("");

  lines.push("FETCH ACTIVITY (non-trivial)");
  lines.push("  time         status  bytes      elapsed  heap-delta  url");
  const fetches = input.events.filter((s) => s.kind === "fetch");
  for (const f of fetches) {
    const d = f.detail ?? {};
    const status = (d.status as number) ?? 0;
    const bytes = (d.bytes as number) ?? 0;
    const elapsed = (d.elapsedMs as number) ?? 0;
    const heapDelta = d.heapDeltaMB as number | null | undefined;
    const deltaText =
      heapDelta == null
        ? "     —   "
        : `${heapDelta >= 0 ? "+" : ""}${heapDelta.toFixed(1)}MB`.padStart(9, " ");
    lines.push(
      `  ${formatTime(f.ts)}  ${String(status).padStart(3, " ")}    ${String(bytes).padStart(8, " ")}B  ${String(elapsed).padStart(5, " ")}ms  ${deltaText}    ${f.label}`,
    );
  }
  if (fetches.length === 0) lines.push("  (none in window)");
  lines.push("");

  lines.push("CLICK EVENTS");
  const clicks = input.events.filter((s) => s.kind === "click");
  for (const c of clicks) {
    lines.push(`  ${formatTime(c.ts)}  ${formatMB(c.heapMB)}   ${c.label}`);
  }
  if (clicks.length === 0) lines.push("  (none)");
  lines.push("");

  lines.push("WEBVIEW STALLS (>50ms of blocked script)");
  lines.push("  time         duration  label");
  const longTasks = input.events.filter((s) => s.kind === "longtask");
  for (const t of longTasks) {
    lines.push(
      `  ${formatTime(t.ts)}  ${String((t.detail?.durationMs as number) ?? 0).padStart(5, " ")}ms    ${t.label}`,
    );
  }
  if (longTasks.length === 0) {
    lines.push(
      input.capabilities.longTasks
        ? "  (none, the webview never blocked for 50ms)"
        : "  (no longtask observer on this webview, the timer drift figure above is the only script stall evidence)",
    );
  }
  lines.push("");

  lines.push("LONG ANIMATION FRAMES (>80ms, split into script / style+layout / paint)");
  lines.push("  time         total   script  style   paint   top scripts");
  const loafs = input.events.filter((s) => s.kind === "loaf");
  for (const l of loafs) {
    const d = l.detail ?? {};
    const scripts = Array.isArray(d.scripts) ? (d.scripts as string[]).join(" | ") : "";
    lines.push(
      `  ${formatTime(l.ts)}  ${String(d.durationMs ?? 0).padStart(5, " ")}ms ${String(d.scriptMs ?? 0).padStart(5, " ")}ms ${String(d.styleMs ?? 0).padStart(5, " ")}ms ${String(d.paintMs ?? 0).padStart(5, " ")}ms  ${scripts}`,
    );
  }
  if (loafs.length === 0) {
    lines.push(
      input.capabilities.loaf
        ? "  (none over 80ms)"
        : "  (no long-animation-frame observer on this webview, only the totals above are available)",
    );
  }
  lines.push("");

  lines.push("SLOW RENDERS (>16ms, missed-frame candidates)");
  lines.push("  time         duration  component");
  const slowRenders = input.events.filter((s) => s.kind === "render");
  for (const r of slowRenders) {
    lines.push(
      `  ${formatTime(r.ts)}  ${String((r.detail?.durationMs as number) ?? 0).padStart(5, " ")}ms    ${r.detail?.componentId ?? r.label}`,
    );
  }
  if (slowRenders.length === 0) {
    lines.push(
      input.renderReport.length === 0
        ? "  (no component reports render timings, this section measures nothing yet)"
        : "  (none, every tracked render under 16ms)",
    );
  }
  lines.push("");

  lines.push("RENDER COST (cumulative per component, sorted by total time)");
  lines.push("  total      count  avg     max     last    component");
  for (const r of input.renderReport) {
    lines.push(
      `  ${String(r.totalMs).padStart(7, " ")}ms ${String(r.count).padStart(5, " ")}  ${String(r.avgMs).padStart(5, " ")}ms ${String(r.maxMs).padStart(5, " ")}ms ${String(r.lastMs).padStart(5, " ")}ms  ${r.id}`,
    );
  }
  if (input.renderReport.length === 0) lines.push("  (nothing calls recordRender)");
  lines.push("");

  lines.push("FULL EVENT TIMELINE (every sample)");
  lines.push("  time          kind     heap     dom     imgs   label");
  for (const s of input.events) {
    lines.push(
      `  ${formatTime(s.ts)}  [${s.kind.padEnd(6)}] ${formatMB(s.heapMB)}  ${String(s.domNodes).padStart(5, " ")}  ${String(s.imgs).padStart(4, " ")}   ${s.label}`,
    );
  }

  return lines.join("\n");
}
