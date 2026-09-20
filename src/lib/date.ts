/** Date helpers, ported verbatim in behaviour from the prototype. */

export const pad = (n: number): string => String(n).padStart(2, '0');

/** Local-time date key, "YYYY-MM-DD". Never use toISOString() here — that is UTC
 *  and shifts the day boundary for anyone east or west of Greenwich. */
export const key = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Month key, "YYYY-MM". */
export const mkey = (d: Date): string => key(d).slice(0, 7);

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Monday of the week containing `d`, at local midnight. */
export const monday = (d: Date): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
};

/** Comparable integer for a "YYYY-MM" key. */
export const monthIndex = (k: string): number => +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1);

/** True for a well-formed, real calendar date string "YYYY-MM-DD". */
export function isDateKey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

export const isMonthKey = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
