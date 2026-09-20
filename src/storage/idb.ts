/** Minimal IndexedDB persistence — no dependency.
 *  Chosen over localStorage because navigator.storage.persist() is built around
 *  it and it leaves room to grow; kept behind this seam either way. */

import { writeMirror, type Persisted } from './mirror.ts';

const DB = 'goal-tracker';
const VERSION = 1;
const KV = 'kv';
const SNAPS = 'snapshots';
const STATE_KEY = 'state';

/** How many pre-import snapshots to retain. "Replace everything" is otherwise
 *  unrecoverable, and it sits one tap away from "Merge". */
export const SNAPSHOT_LIMIT = 3;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS, { keyPath: 'at' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** Stored as {savedAt, state} so boot can compare it against the localStorage
 *  mirror. Records written before this wrapper existed are read as savedAt 0. */
export async function readPersisted(): Promise<Persisted | null> {
  const rec = await tx<unknown>(KV, 'readonly', (s) => s.get(STATE_KEY));
  if (rec === undefined || rec === null) return null;
  if (typeof rec === 'object' && 'state' in (rec as object)) {
    const r = rec as { savedAt?: unknown; state: unknown };
    return { savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0, state: r.state };
  }
  return { savedAt: 0, state: rec };
}

export const writeState = (state: unknown, at = Date.now()): Promise<unknown> =>
  tx(KV, 'readwrite', (s) => s.put({ savedAt: at, state }, STATE_KEY));

export interface Snapshot { at: number; reason: string; state: unknown }

export async function listSnapshots(): Promise<Snapshot[]> {
  const all = await tx<Snapshot[]>(SNAPS, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.at - a.at);
}

/** Store a restore point, pruning to the newest SNAPSHOT_LIMIT. */
export async function putSnapshot(reason: string, state: unknown): Promise<void> {
  await tx(SNAPS, 'readwrite', (s) => s.put({ at: Date.now(), reason, state }));
  const all = await listSnapshots();
  for (const old of all.slice(SNAPSHOT_LIMIT)) {
    await tx(SNAPS, 'readwrite', (s) => s.delete(old.at));
  }
}

/** Debounced writer — replaces the prototype's synchronous save() on every tap.
 *  `flushSync` additionally writes the localStorage mirror, which is the only
 *  write guaranteed to survive the page being torn down. */
export function makeSaver(delay = 300): {
  save: (v: unknown) => void;
  flush: () => Promise<void>;
  flushSync: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown;
  let last: unknown;
  let inflight: Promise<unknown> = Promise.resolve();
  const commit = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending === undefined) return;
    const v = pending;
    pending = undefined;
    inflight = writeState(v).catch((e) => console.error('persist failed', e));
  };
  return {
    save(v) {
      last = v;
      pending = v;
      if (timer) clearTimeout(timer);
      timer = setTimeout(commit, delay);
    },
    async flush() { commit(); await inflight; },
    flushSync() {
      // Synchronous first: an async IndexedDB write may never land from here.
      if (last !== undefined) writeMirror(last);
      commit();
    },
  };
}

/** Ask the browser to exempt this origin from eviction. Best-effort. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export async function isPersisted(): Promise<boolean> {
  try { return (await navigator.storage?.persisted?.()) ?? false; } catch { return false; }
}

export async function estimateUsage(): Promise<number | null> {
  try { return (await navigator.storage?.estimate?.())?.usage ?? null; } catch { return null; }
}
