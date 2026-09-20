import { describe, it, expect } from 'vitest';
import { parseImport } from '../src/backup/import.ts';
import { buildBackup, backupFilename } from '../src/backup/export.ts';
import { merge, previewMerge } from '../src/backup/merge.ts';
import { canonicalToState, importedMarkTime } from '../src/import/canonical.ts';
import { emptyState, isOn, markKey } from '../src/state/schema.ts';

const parse = (o: unknown) => parseImport(JSON.stringify(o));

describe('parseImport rejects bad input', () => {
  it('rejects malformed JSON', () => {
    expect(parseImport('{nope')).toMatchObject({ ok: false });
  });
  it('rejects a backup from a newer app version', () => {
    const r = parse({ format: 'goal-tracker.backup', version: 99, data: { goals: [], marks: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('более новой версией');
  });
  it('rejects an unrecognised shape', () => {
    expect(parse({ unrelated: true, stuff: [1, 2, 3] })).toMatchObject({ ok: false });
  });
  it('rejects an external file with no usable goal names', () => {
    expect(parse({ goals: [{ nope: 1 }] })).toMatchObject({ ok: false });
  });
});

describe('backup round trip', () => {
  it('survives export -> parse with data intact', () => {
    const s = { ...emptyState(), goals: [
      { id: 'aaaaaaaaaaaa', name: 'Спорт', created: '2026-01', createdAt: 100, updatedAt: 100 },
    ], marks: { 'aaaaaaaaaaaa|2026-01-05': 5000 } };
    const r = parse(buildBackup(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('backup');
    expect(r.state.goals).toEqual(s.goals);
    expect(r.state.marks).toEqual(s.marks);
  });

  it('re-importing an unchanged backup is a no-op', () => {
    const s = { ...emptyState(), goals: [
      { id: 'aaaaaaaaaaaa', name: 'X', created: '2026-01', createdAt: 100, updatedAt: 100 },
    ], marks: { 'aaaaaaaaaaaa|2026-01-05': 5000 } };
    const r = parse(buildBackup(s));
    if (!r.ok) throw new Error('parse failed');
    expect(previewMerge(s, r.state)).toMatchObject({ newGoals: 0, updatedGoals: 0, newMarks: 0, conflicts: 0 });
  });

  it('strips marks that reference goals absent from the file', () => {
    const r = parse({
      format: 'goal-tracker.backup', version: 1, deviceId: 'd',
      data: { goals: [], marks: { 'ghost|2026-01-01': 5 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.marks).toEqual({});
  });

  it('names the file by date', () => {
    expect(backupFilename(new Date(2026, 8, 20, 13).getTime())).toBe('goal-tracker-2026-09-20.json');
  });
});

describe('canonical external import', () => {
  it('imports goals and dates', () => {
    const r = parse({ goals: [
      { name: 'Спорт', dates: ['2026-09-01', '2026-09-03'] },
      { name: 'Чтение', dates: ['2026-08-15'] },
    ]});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('external');
    expect(r.detail).toBe('canonical');
    expect(r.state.goals.map((g) => g.name)).toEqual(['Спорт', 'Чтение']);
    expect(Object.values(r.state.marks).every(isOn)).toBe(true);
    expect(Object.keys(r.state.marks)).toHaveLength(3);
  });

  it('backdates `created` so early marks are not hidden by the stats maths', () => {
    const { state } = canonicalToState({ goals: [{ name: 'X', dates: ['2020-03-04'] }] });
    expect(state.goals[0]!.created).toBe('2020-03');
  });

  it('drops invalid dates but keeps the goal, and warns', () => {
    const { state, warnings } = canonicalToState({
      goals: [{ name: 'X', dates: ['2026-09-01', 'garbage', '2026-02-30'] }],
    });
    expect(Object.keys(state.marks)).toHaveLength(1);
    expect(warnings.join(' ')).toContain('некорректных дат: 2');
  });

  it('timestamps marks by their own day, so seeded data never clobbers real edits', () => {
    const t = importedMarkTime('2026-09-01');
    expect(t).toBeLessThan(Date.now());
    expect(importedMarkTime('2026-09-01')).toBe(t); // deterministic across devices
    expect(importedMarkTime('2026-09-02')).toBeGreaterThan(t);
  });

  it('a local unmark beats a later import of the same day', () => {
    const id = 'aaaaaaaaaaaa';
    const k = markKey(id, '2026-09-01');
    const local = { ...emptyState(), goals: [
      { id, name: 'X', created: '2026-09', createdAt: 1, updatedAt: 1 },
    ], marks: { [k]: -Date.now() } };            // user unmarked it just now
    const incoming = { ...emptyState(), goals: local.goals, marks: { [k]: importedMarkTime('2026-09-01') } };
    expect(isOn(merge(local, incoming).marks[k])).toBe(false);
  });

  it('importing the same external file twice is idempotent when ids are given', () => {
    const file = { goals: [{ id: 'fixedfixedaa', name: 'X', dates: ['2026-09-01'] }] };
    const a = parse(file), b = parse(file);
    if (!a.ok || !b.ok) throw new Error('parse failed');
    expect(previewMerge(a.state, b.state)).toMatchObject({ newGoals: 0, newMarks: 0, conflicts: 0 });
  });
});

describe('generic adapter tolerates field-name variation', () => {
  it('maps title/log and ISO timestamps', () => {
    const r = parse({ items: [{ title: 'Бег', log: ['2026-09-01T08:30:00Z', '2026-09-02T07:00:00Z'] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.detail).toBe('generic');
    expect(r.state.goals[0]!.name).toBe('Бег');
    expect(Object.keys(r.state.marks)).toHaveLength(2);
  });

  it('maps a date->bool map, honouring false', () => {
    const r = parse({ habits: [{ name: 'X', days: { '2026-09-01': true, '2026-09-02': false } }] });
    if (!r.ok) throw new Error('parse failed');
    expect(Object.keys(r.state.marks)).toHaveLength(1);
  });

  it('maps a bare top-level array of {name, dates:[{date}]}', () => {
    const r = parse([{ name: 'X', entries: [{ date: '2026-09-01' }, { date: '2026-09-02' }] }]);
    if (!r.ok) throw new Error('parse failed');
    expect(Object.keys(r.state.marks)).toHaveLength(2);
  });

  it('handles a goal with no dates at all', () => {
    const r = parse({ goals: [{ name: 'Новая цель' }] });
    if (!r.ok) throw new Error('parse failed');
    expect(r.state.goals).toHaveLength(1);
    expect(r.state.marks).toEqual({});
  });
});
