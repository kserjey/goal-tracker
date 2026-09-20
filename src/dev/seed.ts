import { addDays, key, mkey } from '../lib/date.ts';
import { emptyState, makeGoal, markKey, type Marks, type State } from '../state/schema.ts';

/** [name, starting rate, monthly drift] — ported from the prototype. */
const PROFILES: [string, number, number][] = [
  ['Спорт и здоровье', 0.45, 0.05],
  ['Не дудонил', 0.85, -0.035],
  ['Семья и близкие', 0.45, 0.02],
  ['Соблазнение Алены', 0.6, -0.06],
  ['Микропродукт', 0.15, 0.07],
  ['Инвестиции', 0.4, 0],
  ['Развитие через чтение', 0.6, -0.05],
  ['Работа и карьера', 0.3, 0.035],
  ['Музыка', 0.35, -0.015],
];

/**
 * 13 months of plausible history, for showing what the stats look like.
 *
 * In the prototype this ran automatically whenever storage was empty, so every
 * real first-time user was handed invented data. It is now reachable only from
 * the Настройки tab.
 */
export function seed(now = new Date()): State {
  let s = 11;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;

  const first = new Date(now.getFullYear(), now.getMonth() - 13, 1);
  const created = mkey(first);
  const todayK = key(now);
  const createdAt = first.getTime();

  const goals = PROFILES.map(([name]) => {
    const g = makeGoal(name!, createdAt);
    g.created = created;
    return g;
  });

  const marks: Marks = {};
  const noise: Record<string, number> = {};
  for (let d = new Date(first); key(d) < todayK; d = addDays(d, 1)) {
    if (rnd() < 0.12) continue; // skipped day
    const m = (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
    const dk = key(d);
    const t = new Date(`${dk}T12:00:00`).getTime();
    goals.forEach((g, i) => {
      const nk = `${i}-${m}`;
      noise[nk] ??= (rnd() - 0.5) * 0.14;
      const [, base, drift] = PROFILES[i]!;
      const p = Math.min(0.95, Math.max(0.05, base + drift * m + noise[nk]!));
      if (rnd() < p) marks[markKey(g.id, dk)] = t;
    });
  }
  return { ...emptyState(), goals, marks };
}
