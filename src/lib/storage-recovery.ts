const PRUNABLE_EXACT = new Set<string>([
  "compass.omdb.v1",
  "compass.omdb.misses",
  "compass.omdb.budget",
  "compass.iptv.hydration.v2",
  "compass.iptv.epgmap.v1",
  "compass.iptv.stats.v1",
  "compass.dead-streams.v1",
  "compass.discover.v1",
  "compass.discover.events.v1",
  "compass.discover.awards.v1",
  "compass.discover.rows.v1",
  "compass.scroll.v1",
  "compass.webhook.lastTick",
  "compass.calendar.webhook.last",
  "compass.anidbtvdbcache",
  "compass.armcache",
  "compass.armkitsucache",
  "compass.armsrcmalcache",
  "compass.extkitsucache",
  "compass.imdb.tmdb.v1",
  "compass.tmdb.imdb.v1",
  "compass.tmdb.personName.v1",
  "compass.awards.wikidata.v8",
  "compass.awards.wikidata.v9",
  "compass.awards.wikidata.v10",
  "compass.anime_awards.metas.v2",
  "compass.animefillercache.v2",
  "compass.jikancatalog",
  "compass.malscorecache",
  "compass.anime.recs_by_mal.v1",
  "compass.anime.toppicks.cache.v1",
  "compass.anime.toppicks.shown.v1",
  "compass.anime.toppicks.visit.v1",
  "compass.anime.mal_id_by_franchise.v1",
  "compass.picker-cache.v4",
  "compass.picker-cache.v5",
  "compass.shows.hero.pool.v2",
  "compass.mdblist.cards",
  "compass.build.rating.v1",
  "compass.parental",
  "compass.lastseason.v1",
  "compass.surprise.recent.v1",
  "compass.stremio-addons.velocity.v1",
  "compass.playback-history.v1",
  "compass.streamBadges.v1",
  "compass.manga.popular.v1",
  "compass.ebook.metadata.v1",
  "compass.heroPool.v1",
]);

const PRUNABLE_PREFIXES = [
  "compass.libraryNameRepair.v1.",
  "compass.anilist.collection.v1.",
  "compass.manga.cache.v1.",
  "compass.manga.cache.v2.",
  "compass.manga.art.",
  "compass.ebook.openlibrary.v1.",
  "compass.tvdbo.",
  "compass.playback-history.v1.",
];

function isPrunable(key: string): boolean {
  if (PRUNABLE_EXACT.has(key)) return true;
  return PRUNABLE_PREFIXES.some((p) => key.startsWith(p));
}

function prunableEntries(): Array<{ key: string; size: number }> {
  const out: Array<{ key: string; size: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isPrunable(key)) continue;
    const v = localStorage.getItem(key);
    if (v == null) continue;
    out.push({ key, size: v.length + key.length });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) {
    if (e.name === "QuotaExceededError") return true;
    if (e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    if (e.code === 22) return true;
    if (e.code === 1014) return true;
  }
  return false;
}

function pruneOne(key: string): number {
  try {
    const cur = localStorage.getItem(key);
    if (cur == null) return 0;
    const freed = cur.length + key.length;
    localStorage.removeItem(key);
    console.info(`[storage] pruned "${key}" to free ${freed} chars`);
    return freed;
  } catch {
    return 0;
  }
}

const SNAP_PREFIX = "compass.snap.";
const SNAP_KEEP = new Set(["compass.snap.index", "compass.snap.retention"]);

function snapshotFrames(): Array<{ key: string; size: number }> {
  const out: Array<{ key: string; size: number }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(SNAP_PREFIX) || SNAP_KEEP.has(key)) continue;
    const v = localStorage.getItem(key);
    if (v == null) continue;
    out.push({ key, size: v.length + key.length });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

export function setItemWithRecovery(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  const evictable = [...prunableEntries(), ...snapshotFrames()];
  for (const { key: candidate } of evictable) {
    if (candidate === key) continue;
    pruneOne(candidate);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!isQuotaError(e)) throw e;
    }
  }
  // Replacing a value can still fail at the quota boundary because WebView storage
  // reserves the new value before releasing the old one. Retry non-destructively by
  // temporarily removing the previous value, and restore it if the replacement fails.
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(key);
    if (previous != null) {
      localStorage.removeItem(key);
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        try {
          localStorage.setItem(key, previous);
        } catch {
          console.error(`[storage] could not restore "${key}" after replacement failed`);
        }
        if (!isQuotaError(e)) throw e;
      }
    }
  } catch (e) {
    if (!isQuotaError(e)) throw e;
  }
  console.warn(`[storage] giving up on "${key}" after pruning every cache`);
  return false;
}

/** Like setItemWithRecovery, but a write that still fails after pruning throws. */
export function setItemOrThrow(key: string, value: string): void {
  if (!setItemWithRecovery(key, value)) throw new Error(`Storage is full; "${key}" was not saved.`);
}

export function freeStorageSpace(): { freedBytes: number; pruned: string[] } {
  let freed = 0;
  const pruned: string[] = [];
  for (const { key } of prunableEntries()) {
    const n = pruneOne(key);
    if (n > 0) {
      freed += n;
      pruned.push(key);
    }
  }
  return { freedBytes: freed, pruned };
}

const pendingCritical = new Map<string, string>();
let flushBound = false;

function bindCriticalFlush(): void {
  if (flushBound || typeof window === "undefined") return;
  flushBound = true;
  const flush = () => {
    if (pendingCritical.size === 0) return;
    for (const [k, v] of pendingCritical) {
      if (setItemWithRecovery(k, v)) pendingCritical.delete(k);
    }
  };
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export function persistCritical(key: string, value: string): boolean {
  bindCriticalFlush();
  const ok = setItemWithRecovery(key, value);
  if (ok) {
    pendingCritical.delete(key);
  } else {
    pendingCritical.set(key, value);
    console.error(`[storage] critical key "${key}" did not persist; will retry before close`);
  }
  return ok;
}

const PROACTIVE_PER_KEY_THRESHOLD = 256 * 1024;
const PROACTIVE_TOTAL_THRESHOLD = 3.5 * 1024 * 1024;

const DEAD_CACHE_PREFIXES = ["compass.picker-cache."];
const VERSIONED_CACHE_PREFIXES = ["compass.awards.wikidata", "compass.anime_awards.metas"];

const LRU_PREFIX_CAPS: Array<{ prefix: string; keep: number }> = [
  { prefix: "compass.tvdbo.", keep: 24 },
];

function capLruPrefixes(): void {
  for (const { prefix, keep } of LRU_PREFIX_CAPS) {
    const found: Array<{ key: string; size: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const v = localStorage.getItem(k);
      if (v == null) continue;
      found.push({ key: k, size: v.length });
    }
    if (found.length <= keep) continue;
    found.sort((a, b) => b.size - a.size);
    for (const f of found.slice(keep)) pruneOne(f.key);
  }
}

function purgeDeadCaches(): void {
  const kill: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && DEAD_CACHE_PREFIXES.some((p) => k.startsWith(p))) kill.push(k);
  }
  for (const k of kill) pruneOne(k);
}

function purgeOldCacheVersions(): void {
  for (const prefix of VERSIONED_CACHE_PREFIXES) {
    const re = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.v(\\d+)$`);
    const found: Array<{ key: string; v: number }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const m = re.exec(k);
      if (m) found.push({ key: k, v: Number(m[1]) });
    }
    if (found.length < 2) continue;
    const max = Math.max(...found.map((f) => f.v));
    for (const f of found) if (f.v < max) pruneOne(f.key);
  }
}

export function proactiveStorageCleanup(): void {
  if (typeof localStorage === "undefined") return;
  purgeDeadCaches();
  purgeOldCacheVersions();
  capLruPrefixes();
  const entries = prunableEntries();
  let total = 0;
  for (const { key, size } of entries) {
    total += size;
    if (size > PROACTIVE_PER_KEY_THRESHOLD) pruneOne(key);
  }
  if (total > PROACTIVE_TOTAL_THRESHOLD) {
    const r = freeStorageSpace();
    console.info(
      `[storage] proactive total cleanup: ${r.pruned.length} caches, ${r.freedBytes} bytes`,
    );
  }
}
