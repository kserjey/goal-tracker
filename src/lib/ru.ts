/** Russian strings and pluralisation, ported from the prototype.
 *  The prototype's `MI` (instrumental case) array was unused and is dropped. */

/** Genitive: "12 января" */
export const MG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
/** Nominative: "Январь 2026" */
export const MN = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
/** Prepositional: "в январе" */
export const MP = ['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
/** Short, for chart axes */
export const MS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
/** Weekday, Sunday-first to match Date#getDay() */
export const WD = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

/** Russian plural selection: forms are [one, few, many]. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = n % 10, b = n % 100;
  const i = a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2;
  return forms[i]!;
}

export const dd = (n: number): string => plural(n, ['день', 'дня', 'дней']);
export const nGoals = (n: number): string => plural(n, ['цель', 'цели', 'целей']);
export const nMarks = (n: number): string => plural(n, ['отметка', 'отметки', 'отметок']);
export const nMarksAcc = (n: number): string => plural(n, ['отметкой', 'отметками', 'отметками']);
export const nDays = (n: number): string => plural(n, ['активный день', 'активных дня', 'активных дней']);
