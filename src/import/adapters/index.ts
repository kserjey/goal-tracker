import type { CanonicalGoal, CanonicalImport } from '../canonical.ts';

/** A source adapter recognises one external shape and normalises it. */
export interface Adapter {
  name: string;
  detect(json: unknown): boolean;
  toCanonical(json: unknown): CanonicalImport;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Field aliases seen in the wild; the exact source shape is not known yet, so
 *  the adapter is lenient by design rather than guessing one vendor's schema. */
const NAME_KEYS = ['name', 'title', 'label', 'goal', 'habit', 'activity'];
const DATE_KEYS = ['dates', 'marks', 'days', 'entries', 'completions', 'log', 'history', 'checkins'];

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Accepts ["2026-01-01", …], [{date}], [{day}], or {"2026-01-01": true}. */
function pickDates(o: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) {
      return v.map((x) => {
        if (typeof x === 'string') return x;
        if (isObj(x)) {
          for (const dk of ['date', 'day', 'on', 'at', 'timestamp']) {
            const d = x[dk];
            if (typeof d === 'string') return d;
          }
        }
        return '';
      }).filter(Boolean).map(normaliseDate);
    }
    if (isObj(v)) {
      return Object.entries(v).filter(([, on]) => !!on).map(([d]) => normaliseDate(d));
    }
  }
  return [];
}

/** Tolerate full ISO timestamps by keeping the date part. */
function normaliseDate(s: string): string {
  const t = s.trim();
  return t.length > 10 && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
}

function rowsOf(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter(isObj);
  if (isObj(json)) {
    for (const k of ['goals', 'items', 'habits', 'activities', 'data']) {
      const v = json[k];
      if (Array.isArray(v)) return v.filter(isObj);
    }
  }
  return [];
}

/** Strict canonical shape: {goals:[{name, dates:[…]}]}. */
export const canonicalAdapter: Adapter = {
  name: 'canonical',
  detect: (json) =>
    isObj(json) && Array.isArray(json['goals']) &&
    json['goals'].every((g) => isObj(g) && typeof g['name'] === 'string' && Array.isArray(g['dates'])),
  toCanonical: (json) => json as CanonicalImport,
};

/** Lenient fallback covering common field-name variations. */
export const genericAdapter: Adapter = {
  name: 'generic',
  detect: (json) => rowsOf(json).some((r) => pickString(r, NAME_KEYS) !== null),
  toCanonical(json) {
    const goals: CanonicalGoal[] = [];
    for (const r of rowsOf(json)) {
      const name = pickString(r, NAME_KEYS);
      if (!name) continue;
      const g: CanonicalGoal = { name, dates: pickDates(r, DATE_KEYS) };
      const created = pickString(r, ['created', 'createdAt', 'since', 'start']);
      if (created && /^\d{4}-\d{2}/.test(created)) g.created = created.slice(0, 7);
      goals.push(g);
    }
    return { goals };
  },
};

export const ADAPTERS: Adapter[] = [canonicalAdapter, genericAdapter];

export const detectAdapter = (json: unknown): Adapter | null =>
  ADAPTERS.find((a) => a.detect(json)) ?? null;
