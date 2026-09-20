import { describe, it, expect } from 'vitest';
import { merge, pickMark, previewMerge } from '../src/backup/merge.ts';
import { emptyState, type Goal, type State } from '../src/state/schema.ts';

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, name: id, created: '2026-01', createdAt: 1000, updatedAt: 1000, ...over,
});

const st = (goals: Goal[], marks: Record<string, number>): State => ({
  ...emptyState(), goals, marks,
});

/** Content equality ignoring goal order and the device-local deviceId. */
const norm = (s: State) => ({
  goals: [...s.goals].sort((a, b) => a.id.localeCompare(b.id)),
  marks: Object.fromEntries(Object.entries(s.marks).sort(([a], [b]) => a.localeCompare(b))),
});

describe('pickMark', () => {
  it('prefers the larger magnitude regardless of sign', () => {
    expect(pickMark(100, -200)).toBe(-200);
    expect(pickMark(-200, 100)).toBe(-200);
    expect(pickMark(-100, 200)).toBe(200);
  });
  it('lets a tombstone beat an older mark', () => {
    expect(pickMark(5, -9)).toBe(-9);
  });
  it('lets a newer mark beat an older tombstone', () => {
    expect(pickMark(-5, 9)).toBe(9);
  });
  it('resolves an exact timestamp tie toward the mark (data-preserving)', () => {
    expect(pickMark(7, -7)).toBe(7);
    expect(pickMark(-7, 7)).toBe(7);
  });
});

describe('merge', () => {
  it('is commutative', () => {
    const a = st([goal('a'), goal('b', { updatedAt: 50 })], { 'a|2026-01-01': 10, 'b|2026-01-02': -30 });
    const b = st([goal('b', { updatedAt: 99, name: 'renamed' }), goal('c')], { 'a|2026-01-01': -20, 'c|2026-02-01': 5 });
    expect(norm(merge(a, b))).toEqual(norm(merge(b, a)));
  });

  it('keeps the newest goal record but the earliest creation date', () => {
    const a = st([goal('g', { updatedAt: 10, created: '2025-03', createdAt: 500, name: 'old' })], {});
    const b = st([goal('g', { updatedAt: 99, created: '2026-01', createdAt: 9000, name: 'new' })], {});
    const out = merge(a, b).goals[0]!;
    expect(out.name).toBe('new');
    expect(out.created).toBe('2025-03');
    expect(out.createdAt).toBe(500);
  });

  it('propagates a deletion tombstone', () => {
    const a = st([goal('g', { updatedAt: 10 })], {});
    const b = st([goal('g', { updatedAt: 99, deletedAt: 99 })], {});
    expect(merge(a, b).goals[0]!.deletedAt).toBe(99);
    expect(merge(b, a).goals[0]!.deletedAt).toBe(99);
  });

  it('does not resurrect a mark that was unmarked on the other device', () => {
    const a = st([goal('g')], { 'g|2026-01-01': 100 });            // still marked here
    const b = st([goal('g')], { 'g|2026-01-01': -200 });           // unmarked later there
    expect(merge(a, b).marks['g|2026-01-01']).toBe(-200);
  });

  it('drops marks orphaned from any goal', () => {
    const a = st([goal('g')], { 'g|2026-01-01': 5 });
    const b = st([], { 'ghost|2026-01-01': 5 });
    expect(Object.keys(merge(a, b).marks)).toEqual(['g|2026-01-01']);
  });

  it('never imports the other device identity', () => {
    const a = emptyState(), b = emptyState();
    expect(merge(a, b).deviceId).toBe(a.deviceId);
  });

  it('converges over a full A -> B -> A round trip', () => {
    let a = st([goal('x'), goal('y')], { 'x|2026-01-01': 100, 'y|2026-01-01': 100 });
    let b = st([goal('x'), goal('z')], { 'x|2026-01-01': 100, 'z|2026-03-01': 400 });
    a = { ...a, marks: { ...a.marks, 'y|2026-01-01': -500 } };     // unmark on A
    b = { ...b, marks: { ...b.marks, 'x|2026-01-02': 600 } };      // new mark on B
    const b2 = merge(b, a);   // export A -> import into B
    const a2 = merge(a, b2);  // export B -> import back into A
    expect(norm(a2)).toEqual(norm(b2));
    expect(a2.marks['y|2026-01-01']).toBe(-500);
    expect(a2.marks['x|2026-01-02']).toBe(600);
    expect(norm(merge(a2, b2))).toEqual(norm(a2)); // idempotent thereafter
  });

  it('is idempotent when merging a state with itself', () => {
    const a = st([goal('a'), goal('b')], { 'a|2026-01-01': 10, 'b|2026-01-02': -30 });
    expect(norm(merge(a, a))).toEqual(norm(a));
  });
});

describe('previewMerge', () => {
  it('counts additions, conflicts and no-op conflicts separately', () => {
    const local = st([goal('a')], { 'a|2026-01-01': 100, 'a|2026-01-02': 900 });
    const incoming = st([goal('a'), goal('b')], {
      'a|2026-01-01': -200, // conflict, incoming wins -> changed
      'a|2026-01-02': 100,  // conflict, local wins -> not changed
      'b|2026-01-01': 50,   // new goal's new mark
    });
    const p = previewMerge(local, incoming);
    expect(p).toMatchObject({ newGoals: 1, newMarks: 1, conflicts: 2, changedMarks: 1 });
  });
  it('reports no changes when importing the same data twice', () => {
    const s = st([goal('a')], { 'a|2026-01-01': 100 });
    const p = previewMerge(s, s);
    expect(p).toMatchObject({ newGoals: 0, updatedGoals: 0, newMarks: 0, conflicts: 0 });
  });
});
