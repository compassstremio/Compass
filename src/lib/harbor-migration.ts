/**
 * Harbor is Compass's former name. A Harbor install that the native side copied into
 * Compass (see src-tauri/src/harbor_import.rs) still carries Harbor's names: storage keys
 * `harbor.*`, IndexedDB databases `harbor-*` and settings fields such as `harborColor`.
 * These helpers map them onto the Compass names and never touch data Compass already has.
 */

const HARBOR = "harbor";
const COMPASS = "compass";
const PENDING_IDB_KEY = "compass.harbor-import.idb-pending.v1";

/** `harbor.x`, `harbor-x` and `harborX` become `compass.x`, `compass-x` and `compassX`. */
export function renameHarborKey(key: string): string | null {
  if (!key.startsWith(HARBOR)) return null;
  const rest = key.slice(HARBOR.length);
  const next = rest.charAt(0);
  if (next === "." || next === "-" || (next >= "A" && next <= "Z")) return COMPASS + rest;
  return null;
}

type KeyStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

/**
 * Moves every Harbor key that has no Compass counterpart yet. A key Compass already holds
 * is left alone on both sides, so running this on every start cannot overwrite anything.
 * Returns how many keys moved.
 */
export function migrateHarborStorage(storage: KeyStorage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && renameHarborKey(key)) keys.push(key);
  }
  let moved = 0;
  for (const key of keys) {
    const target = renameHarborKey(key);
    const value = storage.getItem(key);
    if (!target || value == null || storage.getItem(target) != null) continue;
    try {
      storage.setItem(target, value);
      storage.removeItem(key);
      moved += 1;
    } catch {
      // Out of quota: the Harbor copy stays and the next start retries.
    }
  }
  if (moved > 0) {
    try {
      storage.setItem(PENDING_IDB_KEY, "1");
    } catch {
      void 0;
    }
  }
  return moved;
}

/** Harbor's default relay ran under its own name; Compass falls back to its own default. */
function isHarborRelay(url: string): boolean {
  const host = url
    .trim()
    .toLowerCase()
    .replace(/^(wss?|https?):\/\//, "")
    .replace(/[/:].*$/, "");
  return host.startsWith("harbor-together-relay.");
}

/** Settings fields that Harbor named after itself, mapped in place before parsing. */
export function adoptHarborSettingsFields(parsed: Record<string, unknown>): void {
  for (const field of Object.keys(parsed)) {
    const target = renameHarborKey(field);
    if (!target) continue;
    if (parsed[target] === undefined) parsed[target] = parsed[field];
    delete parsed[field];
  }
  if (parsed.homeMode === HARBOR) parsed.homeMode = COMPASS;
  if (typeof parsed.togetherRelayUrl === "string" && isHarborRelay(parsed.togetherRelayUrl)) {
    parsed.togetherRelayUrl = "";
  }
}

function openDatabase(
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`${name} is blocked`));
  });
}

type StoreSchema = {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[];
};

function readSchema(source: IDBDatabase): StoreSchema[] {
  const names = Array.from(source.objectStoreNames);
  if (names.length === 0) return [];
  const tx = source.transaction(names, "readonly");
  return names.map((name) => {
    const store = tx.objectStore(name);
    return {
      name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: Array.from(store.indexNames).map((indexName) => {
        const index = store.index(indexName);
        return {
          name: indexName,
          keyPath: index.keyPath,
          unique: index.unique,
          multiEntry: index.multiEntry,
        };
      }),
    };
  });
}

function createStores(target: IDBDatabase, schema: StoreSchema[]): void {
  for (const spec of schema) {
    const store = target.createObjectStore(spec.name, {
      keyPath: spec.keyPath,
      autoIncrement: spec.autoIncrement,
    });
    for (const index of spec.indexes) {
      store.createIndex(index.name, index.keyPath, {
        unique: index.unique,
        multiEntry: index.multiEntry,
      });
    }
  }
}

function readRecords(
  source: IDBDatabase,
  name: string,
): Promise<{ key: IDBValidKey; value: unknown }[]> {
  return new Promise((resolve, reject) => {
    const records: { key: IDBValidKey; value: unknown }[] = [];
    const cursorRequest = source.transaction(name, "readonly").objectStore(name).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      records.push({ key: cursor.primaryKey, value: cursor.value });
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

function writeRecords(
  target: IDBDatabase,
  name: string,
  records: { key: IDBValidKey; value: unknown }[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = target.transaction(name, "readwrite");
    const store = tx.objectStore(name);
    for (const { key, value } of records) {
      // A record Compass already wrote wins: add() fails on it and the copy carries on.
      const added = store.keyPath === null ? store.add(value, key) : store.add(value);
      added.onerror = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * A new Compass database takes Harbor's version and schema, so Compass opening it at its
 * own version sees the stores it expects. An existing one keeps its version untouched (a
 * bump would make Compass's next open fail) and only receives records for shared stores.
 */
async function copyDatabase(
  sourceName: string,
  targetName: string,
  targetExists: boolean,
): Promise<void> {
  const source = await openDatabase(sourceName);
  try {
    const schema = readSchema(source);
    const target = targetExists
      ? await openDatabase(targetName)
      : await openDatabase(targetName, source.version, (db) => createStores(db, schema));
    try {
      for (const spec of schema) {
        if (!target.objectStoreNames.contains(spec.name)) continue;
        await writeRecords(target, spec.name, await readRecords(source, spec.name));
      }
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
  indexedDB.deleteDatabase(sourceName);
}

/**
 * Copies Harbor's IndexedDB databases into their Compass names after an import. Runs
 * only when migrateHarborStorage moved keys, so a normal start costs one storage read.
 */
export async function migrateHarborDatabases(): Promise<void> {
  try {
    if (localStorage.getItem(PENDING_IDB_KEY) == null) return;
  } catch {
    return;
  }
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return;
  let failed = false;
  const databases = await indexedDB.databases().catch(() => []);
  const existing = new Set(databases.map((db) => db.name));
  for (const { name } of databases) {
    const target = name ? renameHarborKey(name) : null;
    if (!name || !target) continue;
    try {
      await copyDatabase(name, target, existing.has(target));
    } catch (error) {
      failed = true;
      console.warn(`[harbor-import] could not copy ${name}`, error);
    }
  }
  if (failed) return;
  try {
    localStorage.removeItem(PENDING_IDB_KEY);
  } catch {
    void 0;
  }
}
