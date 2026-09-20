import { addDays, key } from '../lib/date.ts';
import { $, esc } from '../lib/dom.ts';
import { MG, MS, WD } from '../lib/ru.ts';
import { isOn, markKey } from '../state/schema.ts';
import { getState, total, visibleGoals } from '../state/store.ts';
import { todayKey } from '../stats/compute.ts';

/** Columns scale with viewport, as in the prototype. */
export const weeksShown = (): number =>
  innerWidth >= 1100 ? 4 : innerWidth >= 720 ? 2 : 1;

export function renderWeek(start: Date, anim?: string): void {
  const n = weeksShown() * 7;
  const board = $('#board');
  const tk = todayKey();
  document.documentElement.style.setProperty('--days', String(n));

  const meta = Array.from({ length: n }, (_, i) => {
    const d = addDays(start, i);
    const k = key(d);
    const w = d.getDay();
    return {
      d, k,
      cls: [w === 0 || w === 6 ? 'we' : '', k === tk ? 'today' : '', k > tk ? 'future' : ''].join(' '),
    };
  });

  let h = '<div class="row head">';
  for (const { d, cls } of meta) {
    const first = d.getDate() === 1;
    h += `<div class="dh ${cls}${first ? ' mstart' : ''}">` +
      `<span class="wd">${first ? MS[d.getMonth()] : WD[d.getDay()]}</span>` +
      `<span class="dn">${d.getDate()}</span></div>`;
  }
  h += '</div>';

  const { marks } = getState();
  for (const g of visibleGoals()) {
    const nm = esc(g.name);
    h += `<div class="goal"><button class="name" data-open="${g.id}" ` +
      `aria-label="${nm}: статистика и удаление"><span class="nm">${nm}</span>` +
      `<span class="badge">${total(g.id)}</span>` +
      `<span class="more" aria-hidden="true">⋯</span></button><div class="row">`;
    for (const { d, k, cls } of meta) {
      const on = isOn(marks[markKey(g.id, k)]);
      h += `<button class="cell ${cls}${on ? ' on' : ''}" data-g="${g.id}" data-d="${k}" ` +
        `aria-pressed="${on}" aria-label="${nm}, ${d.getDate()} ${MG[d.getMonth()]}"></button>`;
    }
    h += '</div></div>';
  }
  if (!visibleGoals().length) {
    h += '<p class="empty">Целей пока нет. Добавьте первую ниже.</p>';
  }

  board.innerHTML = h;
  board.classList.remove('anim-l', 'anim-r');
  if (anim) { void board.offsetWidth; board.classList.add(anim); }
}
