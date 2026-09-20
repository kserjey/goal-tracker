import { key, monthIndex, pad } from '../lib/date.ts';
import { monthCount } from '../state/store.ts';
import type { Goal } from '../state/schema.ts';

/** The prototype captured `today`/`curK` once at module load, so an app left
 *  open overnight kept highlighting yesterday. These are functions instead. */
export const today = (): Date => new Date();
export const todayKey = (): string => key(today());
export const curMonthKey = (): string => todayKey().slice(0, 7);

export interface MonthInfo {
  y: number;
  m: number;
  /** "YYYY-MM" */
  k: string;
  /** days in the month */
  days: number;
  /** days already elapsed: full month in the past, day-of-month for the current
   *  month, 0 for the future. Drives the "из N прошедших" denominator. */
  elapsed: number;
}

/** Month info, normalising out-of-range months (m = -1 or 12) via Date. */
export function mi(y: number, m: number): MonthInfo {
  const d = new Date(y, m, 1);
  const yy = d.getFullYear(), mm = d.getMonth();
  const k = `${yy}-${pad(mm + 1)}`;
  const cur = curMonthKey();
  return {
    y: yy, m: mm, k,
    days: new Date(yy, mm + 1, 0).getDate(),
    elapsed: k < cur ? new Date(yy, mm + 1, 0).getDate() : k === cur ? today().getDate() : 0,
  };
}

/** Marks for a goal in a month, or null when the month predates the goal or is
 *  still in the future — null renders as an empty bar, not a zero bar. */
export const cntM = (g: Goal, M: MonthInfo): number | null =>
  !M.elapsed || g.created > M.k ? null : monthCount(g.id, M.k);

/**
 * Sliding 12-month window, ported from the prototype unchanged.
 * While the selected month sits at the right edge the window stays put; once it
 * reaches the middle the window slides with it.
 */
export function monthWindow(y: number, m: number, earliest: string): { pos: number; months: MonthInfo[] } {
  const N = 12;
  const sI = y * 12 + m;
  const cI = monthIndex(curMonthKey());
  const eI = monthIndex(earliest);
  const endI = Math.min(cI, Math.max(sI + Math.floor(N / 2) - 1, eI + N - 1));
  const startI = endI - N + 1;
  return {
    pos: sI - startI,
    months: Array.from({ length: N }, (_, i) =>
      mi(Math.floor((startI + i) / 12), (startI + i) % 12)),
  };
}
