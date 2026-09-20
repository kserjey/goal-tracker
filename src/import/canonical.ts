import { isDateKey } from '../lib/date.ts';
import { cleanData, makeGoal, markKey, type Marks, type State, emptyState } from '../state/schema.ts';

/**
 * The documented contract for importing initial data from an external resource:
 *
 *   { "goals": [ { "name": "Спорт", "dates": ["2026-09-01", "2026-09-03"] } ] }
 *
 * Optional per goal: `id`, `created` ("YYYY-MM"). See docs/import-format.md.
 */
export interface CanonicalGoal {
  name: string;
  dates: string[];
  id?: string;
  created?: string;
}
export interface CanonicalImport {
  goals: CanonicalGoal[];
}

/**
 * Timestamp assigned to an imported mark: noon local on the day it records.
 *
 * Deliberately *not* Date.now() — seeded history must never outrank a real edit
 * the user has already made on this device. Anchoring to the day itself is also
 * deterministic, so importing the same file on two devices produces identical
 * data that merges to a no-op.
 */
export const importedMarkTime = (date: string): number =>
  new Date(`${date}T12:00:00`).getTime();

export interface CanonicalResult {
  state: State;
  warnings: string[];
}

/** Turn canonical rows into a mergeable state. */
export function canonicalToState(input: CanonicalImport, now = Date.now()): CanonicalResult {
  const warnings: string[] = [];
  const goals = [];
  const marks: Marks = {};
  let droppedDates = 0;

  for (const raw of input.goals) {
    const name = String(raw.name ?? '').trim();
    if (!name) { warnings.push('Пропущена цель без названия'); continue; }
    const g = makeGoal(name.slice(0, 60), now);
    if (raw.id && typeof raw.id === 'string' && !raw.id.includes('|')) g.id = raw.id;

    let earliest: string | null = null;
    for (const d of raw.dates ?? []) {
      if (!isDateKey(d)) { droppedDates++; continue; }
      marks[markKey(g.id, d)] = importedMarkTime(d);
      if (!earliest || d < earliest) earliest = d;
    }
    // A goal must predate its own marks or the stats maths hides them.
    const created = raw.created ?? (earliest ? earliest.slice(0, 7) : g.created);
    g.created = created < g.created ? created : g.created;
    g.createdAt = Math.min(g.createdAt, new Date(`${g.created}-01T12:00:00`).getTime() || g.createdAt);
    goals.push(g);
  }

  if (droppedDates) warnings.push(`Пропущено некорректных дат: ${droppedDates}`);
  const cleaned = cleanData(goals, marks);
  if (!cleaned.goals.length) warnings.push('Не найдено ни одной цели');
  return { state: { ...emptyState(), ...cleaned }, warnings };
}
