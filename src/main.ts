import './styles.css';
import { registerSW } from 'virtual:pwa-register';

import { addDays, key, monday } from './lib/date.ts';
import { $ } from './lib/dom.ts';
import { MG, MN } from './lib/ru.ts';
import { emptyState, migrate, LEGACY_KEY } from './state/schema.ts';
import {
  addGoal, earliestMonth, getState, setState, subscribe, toggleMark, total,
} from './state/store.ts';
import { curMonthKey, mi, today, todayKey } from './stats/compute.ts';
import { makeSaver, readPersisted, requestPersistence } from './storage/idb.ts';
import { newerOf, readMirror } from './storage/mirror.ts';
import { renderWeek, weeksShown } from './views/week.ts';
import { renderStats } from './views/stats.ts';
import { closeSheet, initSheet, isSheetOpen, onDeleteClick, openSheet } from './views/sheet.ts';
import {
  initSettings, refreshStorageInfo, renderSettings, resetSettingsUi, wireSettings,
} from './views/settings.ts';
import { toast } from './views/toast.ts';

type Tab = 'week' | 'stats' | 'set';

let tab: Tab = 'week';
let start = monday(today());
let statY = today().getFullYear();
let statM = today().getMonth();

/* ---------- persistence ---------- */

const saver = makeSaver();
subscribe(() => saver.save(getState()));
// A backgrounded mobile tab can be killed outright, and an async IndexedDB
// write is not guaranteed to land during teardown — so mirror synchronously.
addEventListener('visibilitychange', () => { if (document.hidden) saver.flushSync(); });
addEventListener('pagehide', () => saver.flushSync());

/** Prototype data lives in localStorage; migrate it once, non-destructively. */
function readLegacy(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function boot(): Promise<void> {
  // Take whichever copy is newer: IndexedDB is primary, but the synchronous
  // mirror wins when the last session was killed before IDB could commit.
  const stored = newerOf(await readPersisted().catch(() => null), readMirror());
  let s = migrate(stored?.state ?? null);
  let migrated = false;
  if (!s) {
    const legacy = migrate(readLegacy());
    if (legacy) { s = legacy; migrated = true; }
  }
  // No fallback to seed(): a real first-time user starts empty.
  setState(s ?? emptyState());
  if (migrated) {
    saver.save(getState());
    toast('Данные из прототипа перенесены');
  }
  render();
  void requestPersistence().then(() => refreshStorageInfo());
}

/* ---------- header ---------- */

const navPrev = (): HTMLButtonElement => $<HTMLButtonElement>('#prev');
const navNext = (): HTMLButtonElement => $<HTMLButtonElement>('#next');

function header(): void {
  const sub = $('#sub');
  const tk = todayKey();
  if (tab === 'set') {
    $('#ttl').textContent = 'Настройки';
    sub.innerHTML = '<span>Данные и резервные копии</span>';
    navPrev().style.visibility = 'hidden';
    navNext().style.visibility = 'hidden';
    navPrev().disabled = true;
    navNext().disabled = true;
    return;
  }
  if (tab === 'week') {
    const n = weeksShown() * 7;
    const last = addDays(start, n - 1);
    const diffYear = start.getFullYear() !== last.getFullYear();
    $('#ttl').textContent =
      start.getMonth() === last.getMonth() && !diffYear
        ? `${start.getDate()} – ${last.getDate()} ${MG[last.getMonth()]}`
        : `${start.getDate()} ${MG[start.getMonth()]}${diffYear ? ' ' + start.getFullYear() : ''} – ${last.getDate()} ${MG[last.getMonth()]}`;
    const isCur = tk >= key(start) && tk <= key(last);
    sub.innerHTML = `<span>${last.getFullYear()}</span>` +
      (isCur ? '<span>Текущая неделя</span>' : '<button class="back" id="goToday">К сегодня</button>');
    navPrev().style.visibility = '';
    navNext().style.visibility = '';
    navPrev().disabled = false;
    navNext().disabled = false;
    navPrev().ariaLabel = 'Предыдущая неделя';
    navNext().ariaLabel = 'Следующая неделя';
  } else {
    const sel = mi(statY, statM);
    const prev = mi(statY, statM - 1);
    const cur = curMonthKey();
    $('#ttl').textContent = `${MN[sel.m]} ${sel.y}`;
    sub.innerHTML = sel.k === cur
      ? '<span>Текущий месяц</span>'
      : '<button class="back" id="goToday">К текущему месяцу</button>';
    navPrev().style.visibility = '';
    navNext().style.visibility = '';
    navNext().disabled = sel.k >= cur;
    navPrev().disabled = prev.k < earliestMonth();
    navPrev().ariaLabel = 'Предыдущий месяц';
    navNext().ariaLabel = 'Следующий месяц';
  }
  const t = document.querySelector<HTMLButtonElement>('#goToday');
  if (t) t.onclick = goToday;
}

/* ---------- render / nav ---------- */

function render(anim?: string): void {
  header();
  if (tab === 'week') renderWeek(start, anim);
  else if (tab === 'stats') renderStats(statY, statM);
  else renderSettings();
}

function shift(dir: number): void {
  if (tab === 'set') return;
  if (tab === 'week') {
    start = addDays(start, 7 * dir);
    render(dir > 0 ? 'anim-l' : 'anim-r');
    return;
  }
  const d = new Date(statY, statM + dir, 1);
  const k = key(d).slice(0, 7);
  if (k > curMonthKey() || k < earliestMonth()) return;
  statY = d.getFullYear();
  statM = d.getMonth();
  render();
}

function goToday(): void {
  const now = today();
  if (tab === 'week') {
    const t = monday(now);
    const anim = t > start ? 'anim-l' : 'anim-r';
    start = t;
    render(anim);
  } else {
    statY = now.getFullYear();
    statM = now.getMonth();
    render();
  }
}

/* ---------- wiring ---------- */

initSheet(() => render());
initSettings(() => { if (tab === 'set') renderSettings(); });
wireSettings();

navPrev().onclick = () => shift(-1);
navNext().onclick = () => shift(1);

let sx = 0, sy = 0, tracking = false;
$('#main').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  if (!t) return;
  sx = t.clientX; sy = t.clientY; tracking = true;
}, { passive: true });
$('#main').addEventListener('touchend', (e) => {
  if (!tracking) return;
  tracking = false;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - sx, dy = t.clientY - sy;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeSheet();
  if (e.target instanceof HTMLInputElement || isSheetOpen()) return;
  if (e.key === 'ArrowLeft') shift(-1);
  if (e.key === 'ArrowRight') shift(1);
});

document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
  b.onclick = () => {
    if (tab === 'set') resetSettingsUi();
    tab = (b.dataset['tab'] ?? 'week') as Tab;
    document.querySelectorAll('.tabs button').forEach((x) =>
      x.setAttribute('aria-pressed', String(x === b)));
    $('#weekView').hidden = tab !== 'week';
    $('#statsView').hidden = tab !== 'stats';
    $('#setView').hidden = tab !== 'set';
    render();
    if (tab === 'set') void refreshStorageInfo();
    scrollTo(0, 0);
  };
});

$('#board').addEventListener('click', (e) => {
  const target = e.target as Element;
  const cell = target.closest<HTMLElement>('.cell');
  if (cell) {
    const g = cell.dataset['g'], d = cell.dataset['d'];
    if (!g || !d) return;
    const on = toggleMark(g, d);
    // Targeted DOM update, as in the prototype: a full re-render here would
    // reshuffle rows under the user's finger, since order derives from counts.
    cell.classList.toggle('on', on);
    cell.setAttribute('aria-pressed', String(on));
    const badge = cell.closest('.goal')?.querySelector('.badge');
    if (badge) badge.textContent = String(total(g));
    return;
  }
  const open = target.closest<HTMLElement>('[data-open]');
  if (open?.dataset['open']) openSheet(open.dataset['open']);
});

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $<HTMLInputElement>('#newGoal');
  const v = inp.value.trim();
  if (!v) return;
  addGoal(v);
  render();
  inp.value = '';
  inp.blur();
  toast(`Цель «${v}» добавлена`);
});

$('#shClose').onclick = closeSheet;
$('#shDel').onclick = onDeleteClick;
$('#scrim').onclick = (e) => { if ((e.target as Element).id === 'scrim') closeSheet(); };

let lastW = weeksShown();
addEventListener('resize', () => {
  if (weeksShown() !== lastW) {
    lastW = weeksShown();
    if (tab === 'week') render();
  }
});

registerSW({ immediate: true });
void boot();
