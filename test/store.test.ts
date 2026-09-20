import { describe, it, expect, beforeEach } from 'vitest';
import {
  addGoal, deleteGoal, earliestMonth, findGoal, getState, restoreGoal,
  setState, toggleMark, total, visibleGoals,
} from '../src/state/store.ts';
import { emptyState, isOn, markKey, type Goal } from '../src/state/schema.ts';

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, name: id, created: '2026-01', createdAt: 1000, updatedAt: 1000, ...over,
});

/** marks for `id` on n distinct days */
const marksFor = (id: string, n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) =>
    [markKey(id, `2026-01-${String(i + 1).padStart(2, '0')}`), 5000]));

beforeEach(() => setState(emptyState()));

describe('derived ordering', () => {
  it('sorts by all-time mark count, descending', () => {
    setState({ ...emptyState(),
      goals: [goal('few'), goal('many'), goal('mid')],
      marks: { ...marksFor('few', 1), ...marksFor('many', 9), ...marksFor('mid', 4) } });
    expect(visibleGoals().map((g) => g.id)).toEqual(['many', 'mid', 'few']);
  });

  it('matches the badge numbers shown next to each name', () => {
    setState({ ...emptyState(),
      goals: [goal('a'), goal('b')],
      marks: { ...marksFor('a', 2), ...marksFor('b', 7) } });
    const shown = visibleGoals().map((g) => total(g.id));
    expect(shown).toEqual([7, 2]);
    expect([...shown].sort((x, y) => y - x)).toEqual(shown); // descending
  });

  it('adds a new zero-mark goal below existing zero-mark goals', () => {
    setState({ ...emptyState(), goals: [goal('old', { createdAt: 10 })], marks: {} });
    const fresh = addGoal('Новая', 99_999);
    expect(visibleGoals().map((g) => g.id)).toEqual(['old', fresh.id]);
  });

  it('keeps several goals added in a row in the order they were typed', () => {
    // Regression: a createdAt-desc tie-break stacked them in reverse, so
    // entering an initial list came out backwards.
    const a = addGoal('Спорт', 1000);
    const b = addGoal('Чтение', 2000);
    const c = addGoal('Музыка', 3000);
    expect(visibleGoals().map((g) => g.name)).toEqual(['Спорт', 'Чтение', 'Музыка']);
    expect(visibleGoals().map((g) => g.id)).toEqual([a.id, b.id, c.id]);
  });

  it('lifts a goal above the others as soon as it is marked', () => {
    addGoal('Первая', 1000);
    const second = addGoal('Вторая', 2000);
    toggleMark(second.id, '2026-01-01', 5000);
    expect(visibleGoals().map((g) => g.name)).toEqual(['Вторая', 'Первая']);
  });

  it('is a total order — no ambiguity when counts and createdAt both tie', () => {
    setState({ ...emptyState(), goals: [goal('b'), goal('a'), goal('c')], marks: {} });
    expect(visibleGoals().map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not count tombstoned marks toward the order', () => {
    setState({ ...emptyState(),
      goals: [goal('a'), goal('b')],
      marks: { ...marksFor('a', 3), 'b|2026-01-01': -9000, 'b|2026-01-02': -9000 } });
    expect(total('b')).toBe(0);
    expect(visibleGoals().map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('stays stable across repeated reads (sort does not mutate into a new order)', () => {
    setState({ ...emptyState(),
      goals: [goal('a'), goal('b'), goal('c')],
      marks: { ...marksFor('b', 5), ...marksFor('c', 2) } });
    expect(visibleGoals().map((g) => g.id)).toEqual(visibleGoals().map((g) => g.id));
  });

  it('hides deleted goals', () => {
    setState({ ...emptyState(), goals: [goal('a'), goal('gone', { deletedAt: 1 })], marks: {} });
    expect(visibleGoals().map((g) => g.id)).toEqual(['a']);
    expect(findGoal('gone')).toBeUndefined();
  });
});

describe('toggleMark', () => {
  it('round-trips on -> off -> on, leaving a tombstone rather than a hole', () => {
    const g = addGoal('X');
    expect(toggleMark(g.id, '2026-01-01', 100)).toBe(true);
    expect(isOn(getState().marks[markKey(g.id, '2026-01-01')])).toBe(true);
    expect(toggleMark(g.id, '2026-01-01', 200)).toBe(false);
    expect(getState().marks[markKey(g.id, '2026-01-01')]).toBe(-200);
    expect(toggleMark(g.id, '2026-01-01', 300)).toBe(true);
    expect(getState().marks[markKey(g.id, '2026-01-01')]).toBe(300);
  });

  it('keeps totals in step with the derived cache after mutation', () => {
    const g = addGoal('X');
    expect(total(g.id)).toBe(0);
    toggleMark(g.id, '2026-01-01', 100);
    expect(total(g.id)).toBe(1);
    toggleMark(g.id, '2026-01-02', 100);
    expect(total(g.id)).toBe(2);
    toggleMark(g.id, '2026-01-01', 200);
    expect(total(g.id)).toBe(1);
  });
});

describe('delete and undo', () => {
  it('preserves marks through delete -> restore', () => {
    const g = addGoal('X');
    toggleMark(g.id, '2026-01-01', 100);
    toggleMark(g.id, '2026-01-02', 100);
    deleteGoal(g.id, 500);
    expect(visibleGoals()).toHaveLength(0);
    restoreGoal(g.id, 600);
    expect(visibleGoals()).toHaveLength(1);
    expect(total(g.id)).toBe(2); // undo is lossless
  });

  it('bumps updatedAt on restore so it outranks the tombstone in a merge', () => {
    const g = addGoal('X', 1);
    deleteGoal(g.id, 500);
    restoreGoal(g.id, 600);
    expect(getState().goals[0]!.updatedAt).toBe(600);
    expect(getState().goals[0]!.deletedAt).toBeUndefined();
  });
});

describe('earliestMonth', () => {
  it('ignores deleted goals', () => {
    setState({ ...emptyState(), goals: [
      goal('a', { created: '2026-05' }),
      goal('ancient', { created: '2001-01', deletedAt: 1 }),
    ], marks: {} });
    expect(earliestMonth()).toBe('2026-05');
  });
});
