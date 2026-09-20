import { $ } from '../lib/dom.ts';
import { nMarksAcc } from '../lib/ru.ts';
import { deleteGoal, findGoal, restoreGoal, total } from '../state/store.ts';
import { mi, monthWindow, today } from '../stats/compute.ts';
import { earliestMonth } from '../state/store.ts';
import { goalStatCard } from './stats.ts';
import { toast } from './toast.ts';

let sheetId: string | null = null;
let lastFocus: Element | null = null;
let rerender: () => void = () => {};

export const initSheet = (onChange: () => void): void => { rerender = onChange; };
export const isSheetOpen = (): boolean => !$('#scrim').hidden;

export function openSheet(id: string): void {
  const g = findGoal(id);
  if (!g) return;
  sheetId = id;
  lastFocus = document.activeElement;
  const now = today();
  const { months, pos } = monthWindow(now.getFullYear(), now.getMonth(), earliestMonth());
  $('#shTitle').textContent = g.name;
  $('#shCard').innerHTML = goalStatCard(g, months, pos, mi(now.getFullYear(), now.getMonth()), 'plain');
  const d = $('#shDel');
  d.classList.remove('confirm');
  d.textContent = 'Удалить цель';
  $('#scrim').hidden = false;
  $('#shClose').focus();
}

export function closeSheet(): void {
  if ($('#scrim').hidden) return;
  $('#scrim').hidden = true;
  sheetId = null;
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

/** Two-step delete: the second tap names the cost before it happens. */
export function onDeleteClick(): void {
  const d = $('#shDel');
  if (!sheetId) return;
  if (!d.classList.contains('confirm')) {
    const n = total(sheetId);
    d.classList.add('confirm');
    d.textContent = n ? `Удалить вместе с ${n} ${nMarksAcc(n)}` : 'Точно удалить';
    return;
  }
  const id = sheetId;
  const g = findGoal(id);
  if (!g) return;
  const name = g.name;
  deleteGoal(id);
  closeSheet();
  rerender();
  toast(`«${name}» удалена`, 'Вернуть', () => {
    restoreGoal(id);
    rerender();
    toast('Цель восстановлена');
  });
}
