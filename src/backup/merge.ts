import type { Goal, Marks, State } from '../state/schema.ts';
import { splitMarkKey } from '../state/schema.ts';

/**
 * Deterministic, commutative merge of two states.
 *
 * Every rule below is a *total* order, so merge(a,b) and merge(b,a) produce the
 * same content and a two-device round trip converges instead of ping-ponging.
 * That property is what makes file export/import a real sync story rather than
 * a destructive overwrite, so it is tested directly.
 */

/** Newest wins; ties broken deterministically (deletion, then serialisation). */
export function pickGoal(a: Goal, b: Goal): Goal {
  let win: Goal;
  if (a.updatedAt !== b.updatedAt) {
    win = a.updatedAt > b.updatedAt ? a : b;
  } else {
    const da = a.deletedAt !== undefined, db = b.deletedAt !== undefined;
    if (da !== db) win = da ? a : b;
    else {
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      win = sa >= sb ? a : b;
    }
  }
  // Creation is a fact about the past: keep the earliest either side knows,
  // regardless of which record won, so stats never lose early history.
  const createdAt = Math.min(a.createdAt, b.createdAt);
  const created = a.created < b.created ? a.created : b.created;
  return createdAt === win.createdAt && created === win.created
    ? win
    : { ...win, createdAt, created };
}

/** Larger |t| wins; on an exact tie the "on" value wins (data-preserving). */
export const pickMark = (a: number, b: number): number => {
  const ta = Math.abs(a), tb = Math.abs(b);
  if (ta !== tb) return ta > tb ? a : b;
  return Math.max(a, b);
};

export function mergeGoals(a: Goal[], b: Goal[]): Goal[] {
  const out = new Map<string, Goal>();
  for (const g of a) out.set(g.id, g);
  for (const g of b) {
    const cur = out.get(g.id);
    out.set(g.id, cur ? pickGoal(cur, g) : g);
  }
  return [...out.values()];
}

export function mergeMarks(a: Marks, b: Marks, liveIds: Set<string>): Marks {
  const out: Marks = {};
  for (const [k, v] of Object.entries(a)) {
    if (liveIds.has(splitMarkKey(k)?.goalId ?? '')) out[k] = v;
  }
  for (const [k, v] of Object.entries(b)) {
    if (!liveIds.has(splitMarkKey(k)?.goalId ?? '')) continue;
    const cur = out[k];
    out[k] = cur === undefined ? v : pickMark(cur, v);
  }
  return out;
}

export function merge(local: State, incoming: State): State {
  const goals = mergeGoals(local.goals, incoming.goals);
  const ids = new Set(goals.map((g) => g.id));
  const out: State = {
    v: local.v,
    deviceId: local.deviceId, // identity of *this* device, never imported
    goals,
    marks: mergeMarks(local.marks, incoming.marks, ids),
  };
  const lb = Math.max(local.lastBackupAt ?? 0, incoming.lastBackupAt ?? 0);
  if (lb) out.lastBackupAt = lb;
  return out;
}

export interface MergePreview {
  newGoals: number;
  updatedGoals: number;
  newMarks: number;
  changedMarks: number;
  /** marks present on both sides with different values — the incoming side may lose */
  conflicts: number;
  totalIncomingGoals: number;
  totalIncomingMarks: number;
}

/** Dry run: what would change, computed without touching stored state. */
export function previewMerge(local: State, incoming: State): MergePreview {
  const byId = new Map(local.goals.map((g) => [g.id, g]));
  let newGoals = 0, updatedGoals = 0;
  for (const g of incoming.goals) {
    const cur = byId.get(g.id);
    if (!cur) newGoals++;
    else if (JSON.stringify(pickGoal(cur, g)) !== JSON.stringify(cur)) updatedGoals++;
  }
  let newMarks = 0, changedMarks = 0, conflicts = 0;
  for (const [k, v] of Object.entries(incoming.marks)) {
    const cur = local.marks[k];
    if (cur === undefined) { newMarks++; continue; }
    if (cur === v) continue;
    conflicts++;
    if (pickMark(cur, v) !== cur) changedMarks++;
  }
  return {
    newGoals,
    updatedGoals,
    newMarks,
    changedMarks,
    conflicts,
    totalIncomingGoals: incoming.goals.filter((g) => !g.deletedAt).length,
    totalIncomingMarks: Object.values(incoming.marks).filter((v) => v > 0).length,
  };
}
