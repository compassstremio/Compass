import { buildAffinity } from "./affinity";
import { freshAffinity, type DiscoverStore, type EventKind, type ProfileSnapshot } from "./types";

const KEY = "compass.discover.v1";
const MAX_EVENTS = 500;
const PERSIST_DEBOUNCE_MS = 5000;
const DUP_WINDOW_MS = 90_000;

let mem: DiscoverStore = load();
const subs = new Set<() => void>();
let persistTimer: number | null = null;
let affinityDirty = false;

function flushAffinity() {
  if (!affinityDirty) return;
  mem.affinity = buildAffinity(mem.events, Date.now());
  affinityDirty = false;
}

function load(): DiscoverStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { events: [], affinity: freshAffinity() };
    const parsed = JSON.parse(raw);
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      affinity: parsed.affinity ?? freshAffinity(),
    };
  } catch {
    return { events: [], affinity: freshAffinity() };
  }
}

function persistSoon() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    flushAffinity();
    try {
      localStorage.setItem(KEY, JSON.stringify(mem));
    } catch {
      mem = { ...mem, events: mem.events.slice(-Math.floor(MAX_EVENTS / 2)) };
      try {
        localStorage.setItem(KEY, JSON.stringify(mem));
      } catch {
        /* give up silently — we're on a constrained device */
      }
    }
  }, PERSIST_DEBOUNCE_MS);
}

function notify() {
  subs.forEach((fn) => fn());
}

export function trackEvent(id: string, kind: EventKind, meta?: ProfileSnapshot, ts?: number) {
  if (!id) return;
  const now = ts ?? Date.now();
  const recent = mem.events[mem.events.length - 1];
  if (recent && recent.id === id && recent.kind === kind && now - recent.ts < DUP_WINDOW_MS) {
    if (meta) recent.meta = meta;
  } else {
    mem.events.push({ id, kind, ts: now, meta });
    while (mem.events.length > MAX_EVENTS) mem.events.shift();
  }
  affinityDirty = true;
  persistSoon();
  notify();
}

export function profileForId(id: string): ProfileSnapshot | undefined {
  for (let i = mem.events.length - 1; i >= 0; i--) {
    const e = mem.events[i];
    if (e.id === id && e.meta) return e.meta;
  }
  return undefined;
}

export function getStore(): DiscoverStore {
  flushAffinity();
  return mem;
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function clearStore() {
  mem = { events: [], affinity: freshAffinity() };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}
