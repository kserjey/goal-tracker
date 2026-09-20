import { isDateKey, isMonthKey, mkey } from '../lib/date.ts';
import { newId } from '../lib/dom.ts';

export const SCHEMA_VERSION = 1 as const;

/** localStorage key written by the original goal-tracker.html prototype. */
export const LEGACY_KEY = 'tracker-proto-v4';

/** Timestamp assigned to marks recovered from the prototype, which had none.
 *  Deliberately tiny so that any real edit on any device outranks legacy data,
 *  and so two devices migrating the same blob produce byte-identical state. */
export const LEGACY_EPOCH = 1;

export interface Goal {
  id: string;
  name: string;
  /** "YYYY-MM". Retained because the stats maths keys off it. */
  created: string;
  createdAt: number;
  /** epoch ms; drives goal-level merge */
  updatedAt: number;
  /** tombstone: hidden from views, retained so deletion survives a merge */
  deletedAt?: number;
}

/**
 * Marks are `"goalId|YYYY-MM-DD" -> signed epoch ms`:
 *   +t  marked at t
 *   -t  unmarked at t
 * One number carries both the value and the tombstone, so merge is a magnitude
 * comparison per key — commutative and associative, and correct for the unmark
 * case a naive union gets wrong. There is no "absent means unmarked" ambiguity
 * once a key exists.
 */
export type Marks = Record<string, number>;

export interface State {
  v: typeof SCHEMA_VERSION;
  deviceId: string;
  goals: Goal[];
  marks: Marks;
  lastBackupAt?: number;
}

/* ---------- mark encoding ---------- */

export const markKey = (goalId: string, date: string): string => `${goalId}|${date}`;
export const isOn = (v: number | undefined): boolean => v !== undefined && v > 0;
export const markTime = (v: number): number => Math.abs(v);
export const encodeMark = (on: boolean, t: number): number => (on ? t : -t);

/** Split a mark key. Goal ids never contain "|", so the first segment is safe. */
export function splitMarkKey(k: string): { goalId: string; date: string } | null {
  const i = k.indexOf('|');
  if (i <= 0) return null;
  return { goalId: k.slice(0, i), date: k.slice(i + 1) };
}

/* ---------- construction ---------- */

export function emptyState(): State {
  return { v: SCHEMA_VERSION, deviceId: newId(), goals: [], marks: {} };
}

export function makeGoal(name: string, now = Date.now()): Goal {
  return {
    id: newId(),
    name,
    created: mkey(new Date(now)),
    createdAt: now,
    updatedAt: now,
  };
}

/* ---------- validation ---------- */

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Coerce an untrusted goal, or null if unusable. */
function cleanGoal(raw: unknown): Goal | null {
  if (!isObj(raw)) return null;
  const id = raw['id'];
  const name = raw['name'];
  if (typeof id !== 'string' || !id || id.includes('|')) return null;
  if (typeof name !== 'string') return null;
  const createdAt = typeof raw['createdAt'] === 'number' ? raw['createdAt'] : LEGACY_EPOCH;
  const g: Goal = {
    id,
    name: name.slice(0, 60),
    created: isMonthKey(raw['created']) ? raw['created'] : mkey(new Date(createdAt)),
    createdAt,
    updatedAt: typeof raw['updatedAt'] === 'number' ? raw['updatedAt'] : createdAt,
  };
  if (typeof raw['deletedAt'] === 'number') g.deletedAt = raw['deletedAt'];
  return g;
}

/** Coerce untrusted `{goals, marks}` into a consistent pair.
 *  Drops duplicate goal ids and marks that are malformed or orphaned. */
export function cleanData(rawGoals: unknown, rawMarks: unknown): { goals: Goal[]; marks: Marks } {
  const goals: Goal[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawGoals)) {
    for (const r of rawGoals) {
      const g = cleanGoal(r);
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      goals.push(g);
    }
  }
  const marks: Marks = {};
  if (isObj(rawMarks)) {
    for (const [k, v] of Object.entries(rawMarks)) {
      const parts = splitMarkKey(k);
      if (!parts || !seen.has(parts.goalId) || !isDateKey(parts.date)) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
      marks[k] = Math.trunc(v);
    }
  }
  return { goals, marks };
}

/* ---------- migration ---------- */

/** Shape written by the prototype: marks are a bare `1`, ids are "g0", "g1"… */
function migrateV0(raw: Record<string, unknown>): State {
  const st = emptyState();
  const idMap = new Map<string, string>();
  if (Array.isArray(raw['goals'])) {
    for (const r of raw['goals']) {
      if (!isObj(r) || typeof r['id'] !== 'string' || typeof r['name'] !== 'string') continue;
      const id = newId();
      idMap.set(r['id'], id);
      const created = isMonthKey(r['created']) ? r['created'] : mkey(new Date());
      st.goals.push({
        id,
        name: r['name'].slice(0, 60),
        created,
        createdAt: new Date(`${created}-01T00:00:00`).getTime() || LEGACY_EPOCH,
        updatedAt: LEGACY_EPOCH,
      });
    }
  }
  if (isObj(raw['marks'])) {
    for (const [k, v] of Object.entries(raw['marks'])) {
      if (!v) continue; // prototype stored 1, and deleted the key to unmark
      const parts = splitMarkKey(k);
      if (!parts) continue;
      const id = idMap.get(parts.goalId);
      if (!id || !isDateKey(parts.date)) continue;
      st.marks[markKey(id, parts.date)] = LEGACY_EPOCH;
    }
  }
  return st;
}

/**
 * Bring any persisted shape forward to the current version.
 * Returns null when `raw` is not recognisable as app data at all, so callers can
 * tell "nothing stored yet" apart from "stored but empty".
 */
export function migrate(raw: unknown): State | null {
  if (!isObj(raw)) return null;
  if (raw['v'] === SCHEMA_VERSION) {
    const { goals, marks } = cleanData(raw['goals'], raw['marks']);
    const st: State = {
      v: SCHEMA_VERSION,
      deviceId: typeof raw['deviceId'] === 'string' && raw['deviceId'] ? raw['deviceId'] : newId(),
      goals,
      marks,
    };
    if (typeof raw['lastBackupAt'] === 'number') st.lastBackupAt = raw['lastBackupAt'];
    return st;
  }
  // v0: the prototype blob had no `v` field at all, just goals + marks.
  if (raw['v'] === undefined && Array.isArray(raw['goals'])) return migrateV0(raw);
  return null;
}
