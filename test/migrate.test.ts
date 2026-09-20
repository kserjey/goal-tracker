import { describe, it, expect } from 'vitest';
import { migrate, cleanData, isOn, LEGACY_EPOCH, SCHEMA_VERSION } from '../src/state/schema.ts';

/** The exact shape goal-tracker.html wrote to localStorage under tracker-proto-v4. */
const legacy = {
  goals: [
    { id: 'g0', name: 'Спорт и здоровье', created: '2025-08' },
    { id: 'g1', name: 'Не дудонил', created: '2025-08' },
    { id: 'g2', name: 'Музыка', created: '2025-08' },
  ],
  marks: {
    'g0|2025-08-01': 1,
    'g0|2025-08-02': 1,
    'g1|2025-08-01': 1,
    'g2|2026-01-15': 1,
  },
};

describe('migrate v0 (prototype blob)', () => {
  it('produces valid v1 state', () => {
    const s = migrate(structuredClone(legacy))!;
    expect(s.v).toBe(SCHEMA_VERSION);
    expect(s.deviceId).toMatch(/^[a-z0-9]{12}$/);
    expect(s.goals).toHaveLength(3);
  });

  it('preserves every mark and keeps them "on"', () => {
    const s = migrate(structuredClone(legacy))!;
    expect(Object.keys(s.marks)).toHaveLength(4);
    expect(Object.values(s.marks).every(isOn)).toBe(true);
    expect(Object.values(s.marks).every((v) => v === LEGACY_EPOCH)).toBe(true);
  });

  it('remaps ids off the collision-prone g0/g1 scheme, consistently across marks', () => {
    const s = migrate(structuredClone(legacy))!;
    const ids = s.goals.map((g) => g.id);
    expect(ids.some((i) => /^g\d+$/.test(i))).toBe(false);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{12}$/);

    // every mark key points at a real, migrated goal
    const byName = Object.fromEntries(s.goals.map((g) => [g.name, g.id]));
    const keys = Object.keys(s.marks);
    expect(keys.filter((k) => k.startsWith(byName['Спорт и здоровье']! + '|'))).toHaveLength(2);
    expect(keys.filter((k) => k.startsWith(byName['Не дудонил']! + '|'))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith(byName['Музыка']! + '|'))).toHaveLength(1);
  });

  it('gives two devices migrating the same blob identical data (only deviceId differs)', () => {
    const a = migrate(structuredClone(legacy))!;
    const b = migrate(structuredClone(legacy))!;
    expect(Object.values(a.marks)).toEqual(Object.values(b.marks));
    expect(a.goals.map((g) => [g.name, g.created, g.updatedAt]))
      .toEqual(b.goals.map((g) => [g.name, g.created, g.updatedAt]));
  });

  it('carries the created month across, and derives createdAt from it', () => {
    const s = migrate(structuredClone(legacy))!;
    const g = s.goals.find((x) => x.name === 'Спорт и здоровье')!;
    expect(g.created).toBe('2025-08');
    expect(new Date(g.createdAt).getFullYear()).toBe(2025);
    expect(new Date(g.createdAt).getMonth()).toBe(7);
  });

  it('ignores falsy legacy marks (the prototype deleted keys to unmark)', () => {
    const s = migrate({ goals: legacy.goals, marks: { 'g0|2025-08-01': 0 } })!;
    expect(Object.keys(s.marks)).toHaveLength(0);
  });
});

describe('migrate v1 round trip', () => {
  it('accepts its own output unchanged apart from identity', () => {
    const once = migrate(structuredClone(legacy))!;
    const twice = migrate(JSON.parse(JSON.stringify(once)))!;
    expect(twice.goals).toEqual(once.goals);
    expect(twice.marks).toEqual(once.marks);
    expect(twice.deviceId).toBe(once.deviceId);
  });
  it('preserves lastBackupAt', () => {
    const s = migrate({ v: 1, deviceId: 'abcabcabcabc', goals: [], marks: {}, lastBackupAt: 42 })!;
    expect(s.lastBackupAt).toBe(42);
  });
});

describe('migrate rejects non-app data', () => {
  it.each([null, undefined, 42, 'str', [], {}, { v: 99 }, { hello: 'world' }])('%s -> null', (x) => {
    expect(migrate(x)).toBeNull();
  });
});

describe('cleanData hardening (untrusted import payloads)', () => {
  const goals = [{ id: 'aaaaaaaaaaaa', name: 'ok', created: '2026-01', createdAt: 1, updatedAt: 1 }];

  it('drops marks with malformed or impossible dates', () => {
    const { marks } = cleanData(goals, {
      'aaaaaaaaaaaa|2026-01-01': 5,
      'aaaaaaaaaaaa|2026-02-30': 5,  // 30 Feb does not exist
      'aaaaaaaaaaaa|2026-13-01': 5,  // month 13
      'aaaaaaaaaaaa|nonsense': 5,
      'aaaaaaaaaaaa': 5,             // no separator
    });
    expect(Object.keys(marks)).toEqual(['aaaaaaaaaaaa|2026-01-01']);
  });

  it('drops marks orphaned from any goal', () => {
    const { marks } = cleanData(goals, { 'ghost|2026-01-01': 5 });
    expect(marks).toEqual({});
  });

  it('drops non-numeric, zero and non-finite mark values', () => {
    const { marks } = cleanData(goals, {
      'aaaaaaaaaaaa|2026-01-01': 'yes',
      'aaaaaaaaaaaa|2026-01-02': 0,
      'aaaaaaaaaaaa|2026-01-03': NaN,
      'aaaaaaaaaaaa|2026-01-04': Infinity,
    });
    expect(marks).toEqual({});
  });

  it('rejects goal ids containing the mark-key separator', () => {
    const { goals: g } = cleanData([{ id: 'a|b', name: 'x' }], {});
    expect(g).toEqual([]);
  });

  it('de-duplicates repeated goal ids', () => {
    const { goals: g } = cleanData(
      [{ id: 'dup', name: 'first' }, { id: 'dup', name: 'second' }], {});
    expect(g).toHaveLength(1);
    expect(g[0]!.name).toBe('first');
  });

  it('truncates absurdly long names', () => {
    const { goals: g } = cleanData([{ id: 'x', name: 'y'.repeat(500) }], {});
    expect(g[0]!.name).toHaveLength(60);
  });
});
