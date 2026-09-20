import { pad } from '../lib/date.ts';
import { $, esc } from '../lib/dom.ts';
import { dd, MN, MP, MS, nDays } from '../lib/ru.ts';
import type { Goal } from '../state/schema.ts';
import { activeDays, earliestMonth, total, visibleGoals } from '../state/store.ts';
import { cntM, curMonthKey, mi, monthWindow, today, todayKey, type MonthInfo } from '../stats/compute.ts';

/** `values` are 0..1 bar heights; null renders an empty slot, not a zero bar. */
export function barsHtml(
  values: (number | null)[], months: MonthInfo[], selK: string, labels: (string | number)[],
): string {
  const cur = curMonthKey();
  return months.map((M, i) => {
    const r = values[i] ?? null;
    const h = r == null ? 0 : Math.max(3, r * 100);
    return `<div class="bar${M.k === selK ? ' sel' : ''}${M.k === cur ? ' part' : ''}">` +
      `<b>${r == null ? '' : labels[i]}</b>` +
      `<div class="t"><i style="height:${h}%"></i></div>` +
      `<span>${MS[M.m]}</span></div>`;
  }).join('');
}

/** Per-goal month card, shared by the Статистика tab and the goal sheet. */
export function goalStatCard(
  g: Goal, months: MonthInfo[], pos: number, sel: MonthInfo, variant?: 'plain',
): string {
  const cs = months.map((M) => cntM(g, M));
  const c = cs[pos] ?? null;
  const gm = Math.max(1, ...cs.map((x) => x ?? 0));

  // Best month across the goal's whole life, not just the visible window.
  let best: { M: MonthInfo; v: number } | null = null;
  const cur = curMonthKey();
  for (let d = new Date(+g.created.slice(0, 4), +g.created.slice(5, 7) - 1, 1);
       `${d.getFullYear()}-${pad(d.getMonth() + 1)}` <= cur;
       d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const M = mi(d.getFullYear(), d.getMonth());
    const v = cntM(g, M);
    if (v != null && (!best || v > best.v)) best = { M, v };
  }

  const bestTxt = !best || c == null || !best.v ? ''
    : best.M.k === sel.k ? '<span class="goodm">Это лучший месяц</span>'
    : `Лучший месяц — ${MN[best.M.m]!.toLowerCase()}` +
      `${best.M.y !== today().getFullYear() ? ' ' + best.M.y : ''}, ${best.v} ${dd(best.v)}`;
  const sub = c == null ? 'Цели в этом месяце ещё не было'
    : `В ${MP[sel.m]} ${c} ${dd(c)}. ${bestTxt}`;

  return `<div class="sgoal ${variant === 'plain' ? 'plain' : 'goal'}">` +
    `<div class="name"><span class="nm">${esc(g.name)}</span>` +
    `<span class="badge">${total(g.id)}</span></div>` +
    `<div class="gsub">${sub}</div>` +
    `<div class="bars y12">${barsHtml(
      cs.map((x) => (x == null ? null : x / gm)), months, sel.k, cs.map((x) => x ?? ''))}</div></div>`;
}

export function renderStats(statY: number, statM: number): void {
  const el = $('#statsView');
  const goals = visibleGoals();
  if (!goals.length) {
    el.innerHTML = '<p class="empty">Целей пока нет. Добавьте их на вкладке «Неделя».</p>';
    return;
  }
  const sel = mi(statY, statM);
  const earliest = earliestMonth();
  const { months, pos } = monthWindow(statY, statM, earliest);
  const tk = todayKey();
  const cur = curMonthKey();
  const active = activeDays();
  const todayOn = active.has(tk);

  /** An active day is one where at least one goal is marked. Today only counts
   *  once it actually has a mark, so the ratio never reads as a miss mid-day. */
  const actIn = (M: MonthInfo): { n: number; last: number } | null => {
    if (!M.elapsed || M.k < earliest) return null;
    const last = M.k === cur ? today().getDate() - (todayOn ? 0 : 1) : M.days;
    let n = 0;
    for (let d = 1; d <= last; d++) if (active.has(`${M.k}-${pad(d)}`)) n++;
    return { n, last };
  };

  const am = months.map(actIn);
  const aSel = am[pos] ?? null;
  const partial = sel.k === cur;
  let totalA = 0;
  for (const d of active) if (d <= tk) totalA++;
  const mx = Math.max(1, ...am.map((x) => x?.n ?? 0));

  let h = `<section class="summary" aria-label="Сводка за месяц">
    <div class="sumhead"><span class="snum">${aSel ? aSel.n : '—'}</span>
      <span class="slbl">${aSel
        ? `${nDays(aSel.n)} из ${aSel.last}${partial ? ' прошедших' : ''}`
        : 'нет данных'}</span></div>
    <div class="ssub">Активный день — отмечена хотя бы одна цель. За всё время ${totalA} ${dd(totalA)}.</div>
    <div class="bars y12">${barsHtml(
      am.map((x) => (x ? x.n / mx : null)), months, sel.k, am.map((x) => x?.n ?? ''))}</div>
  </section>
  <h2 class="listh">Цели</h2>
  <div class="cards">`;

  for (const g of goals) h += goalStatCard(g, months, pos, sel);
  el.innerHTML = h + '</div>';
}
