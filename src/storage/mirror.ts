/**
 * Synchronous crash-safety mirror.
 *
 * The primary store is IndexedDB, but its writes are asynchronous and are *not*
 * guaranteed to complete while a page is being torn down. A mark toggled and
 * immediately followed by closing the tab — or by iOS killing a backgrounded
 * PWA — would otherwise be lost.
 *
 * localStorage writes are synchronous and do complete during unload, so the
 * state is mirrored there on pagehide/visibilitychange. Boot takes whichever
 * copy is newer. This costs nothing per tap: the mirror is written only when
 * the page is actually going away.
 */
export const MIRROR_KEY = 'goal-tracker-mirror';

export interface Persisted { savedAt: number; state: unknown }

export function writeMirror(state: unknown, at = Date.now()): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ savedAt: at, state }));
  } catch {
    // Quota or a privacy mode that blocks storage: IndexedDB remains primary.
  }
}

export function readMirror(): Persisted | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (typeof p === 'object' && p !== null && 'state' in p) {
      const rec = p as { savedAt?: unknown; state: unknown };
      return { savedAt: typeof rec.savedAt === 'number' ? rec.savedAt : 0, state: rec.state };
    }
  } catch { /* ignore corrupt mirror */ }
  return null;
}

/** Pick the newer of the two copies. */
export function newerOf(a: Persisted | null, b: Persisted | null): Persisted | null {
  if (!a) return b;
  if (!b) return a;
  return a.savedAt >= b.savedAt ? a : b;
}
