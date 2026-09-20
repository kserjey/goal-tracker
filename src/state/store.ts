import { mkey } from '../lib/date.ts';
import {
  emptyState, encodeMark, isOn, makeGoal, markKey, splitMarkKey,
  type Goal, type State,
} from './schema.ts';

let state: State = emptyState();
/** Bumped on every mutation; all derived caches key off it. */
let rev = 0;
const listeners = new Set<() => void>();

export const getState = (): State => state;
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function changed(): void {
  rev++;
  for (const fn of listeners) fn();
}

/** Install state loaded from disk or produced by an import. */
export function setState(next: State): void {
  state = next;
  changed();
}

/* ---------- derived, memoised ---------- */

interface Derived {
  rev: number;
  /** goalId -> all-time count of "on" marks */
  totals: Map<string, number>;
  /** goalId -> "YYYY-MM" -> count */
  byMonth: Map<string, Map<string, number>>;
  /** every date with at least one "on" mark */
  activeDays: Set<string>;
}
let cache: Derived | null = null;

function derive(): Derived {
  if (cache && cache.rev === rev) return cache;
  const totals = new Map<string, number>();
  const byMonth = new Map<string, Map<string, number>>();
  const activeDays = new Set<string>();
  const live = new Set(state.goals.filter((g) => !g.deletedAt).map((g) => g.id));
  // One pass over marks, rather than the prototype's per-badge full scan.
  for (const [k, v] of Object.entries(state.marks)) {
    if (!isOn(v)) continue;
    const p = splitMarkKey(k);
    if (!p) continue;
    totals.set(p.goalId, (totals.get(p.goalId) ?? 0) + 1);
    let m = byMonth.get(p.goalId);
    if (!m) byMonth.set(p.goalId, (m = new Map()));
    const mk = p.date.slice(0, 7);
    m.set(mk, (m.get(mk) ?? 0) + 1);
    if (live.has(p.goalId)) activeDays.add(p.date);
  }
  cache = { rev, totals, byMonth, activeDays };
  return cache;
}

export const total = (goalId: string): number => derive().totals.get(goalId) ?? 0;
export const monthCount = (goalId: string, monthK: string): number =>
  derive().byMonth.get(goalId)?.get(monthK) ?? 0;
export const activeDays = (): Set<string> => derive().activeDays;

/**
 * Render order is derived, never stored: all-time mark count descending.
 * A stored `order` field would be a third thing merge() has to reconcile, with
 * no correct answer when two devices reorder independently.
 *
 * All-time (not marks in the visible period) so swiping between weeks never
 * reshuffles rows — and so the order matches the badge numbers on screen.
 * Ties break by createdAt asc then id, giving a total, deterministic order.
 * Ascending, not descending: several goals added in a row would otherwise stack
 * up in reverse, which makes entering an initial list feel broken. A new goal
 * therefore joins the bottom of the zero-mark group and climbs as it is used.
 */
export function visibleGoals(): Goal[] {
  const t = derive().totals;
  return state.goals
    .filter((g) => !g.deletedAt)
    .sort((a, b) =>
      (t.get(b.id) ?? 0) - (t.get(a.id) ?? 0) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id));
}

export const findGoal = (id: string): Goal | undefined =>
  state.goals.find((g) => g.id === id && !g.deletedAt);

/** Earliest month any live goal existed — the left edge of the stats range. */
export function earliestMonth(): string {
  const cur = mkey(new Date());
  return state.goals.reduce((a, g) => (!g.deletedAt && g.created < a ? g.created : a), cur);
}

/* ---------- mutations ---------- */

export function toggleMark(goalId: string, date: string, now = Date.now()): boolean {
  const k = markKey(goalId, date);
  const on = !isOn(state.marks[k]);
  state.marks[k] = encodeMark(on, now);
  changed();
  return on;
}

export function addGoal(name: string, now = Date.now()): Goal {
  const g = makeGoal(name, now);
  state.goals.push(g);
  changed();
  return g;
}

/**
 * Soft delete. The goal tombstone alone carries the deletion across a merge, so
 * marks are deliberately left intact: tombstoning every mark would be hundreds
 * of writes and would make undo lossy.
 */
export function deleteGoal(id: string, now = Date.now()): void {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  g.deletedAt = now;
  g.updatedAt = now;
  changed();
}

/** Undo a delete. Bumping updatedAt is what makes the restore outrank the
 *  tombstone if the deleted version comes back from another device. */
export function restoreGoal(id: string, now = Date.now()): void {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  delete g.deletedAt;
  g.updatedAt = now;
  changed();
}

export function renameGoal(id: string, name: string, now = Date.now()): void {
  const g = state.goals.find((x) => x.id === id);
  if (!g) return;
  g.name = name;
  g.updatedAt = now;
  changed();
}

export function setLastBackup(at: number): void {
  state.lastBackupAt = at;
  changed();
}
