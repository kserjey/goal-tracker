// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWeek } from '../../src/views/week.ts';
import { renderStats } from '../../src/views/stats.ts';
import { goalStatCard } from '../../src/views/stats.ts';
import { addGoal, setState, toggleMark, visibleGoals } from '../../src/state/store.ts';
import { emptyState, markKey, type Goal } from '../../src/state/schema.ts';
import { mi, monthWindow } from '../../src/stats/compute.ts';

/** Use the real shipped markup, so a shell/view mismatch fails the test. */
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

const goal = (id: string, over: Partial<Goal> = {}): Goal => ({
  id, name: id, created: '2020-01', createdAt: 1000, updatedAt: 1000, ...over,
});
const marksFor = (id: string, n: number, month = '2026-01') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) =>
    [markKey(id, `${month}-${String(i + 1).padStart(2, '0')}`), 5000]));

beforeEach(() => {
  document.body.innerHTML = body;
  setState(emptyState());
});

describe('week grid', () => {
  it('renders a 7-column header plus one row per goal', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    const a = addGoal('Спорт');
    const b = addGoal('Чтение');
    renderWeek(new Date(2026, 0, 5)); // a Monday

    expect(document.querySelectorAll('.row.head .dh')).toHaveLength(7);
    expect(document.querySelectorAll('.goal')).toHaveLength(2);
    for (const g of [a, b]) {
      expect(document.querySelectorAll(`.cell[data-g="${g.id}"]`)).toHaveLength(7);
    }
    expect(document.querySelector('.dh .dn')!.textContent).toBe('5');
  });

  it('marks weekend columns and reflects mark state on cells', () => {
    const g = addGoal('X');
    toggleMark(g.id, '2026-01-10'); // Saturday
    renderWeek(new Date(2026, 0, 5));

    const sat = document.querySelector<HTMLElement>(`.cell[data-d="2026-01-10"]`)!;
    expect(sat.classList.contains('we')).toBe(true);
    expect(sat.classList.contains('on')).toBe(true);
    expect(sat.getAttribute('aria-pressed')).toBe('true');
    const sun = document.querySelector<HTMLElement>(`.cell[data-d="2026-01-11"]`)!;
    expect(sun.classList.contains('on')).toBe(false);
  });

  it('orders rows by mark count and shows matching badges', () => {
    setState({ ...emptyState(),
      goals: [goal('low'), goal('high'), goal('mid')],
      marks: { ...marksFor('low', 1), ...marksFor('high', 9), ...marksFor('mid', 4) } });
    renderWeek(new Date(2026, 0, 5));

    const names = [...document.querySelectorAll('.goal .nm')].map((e) => e.textContent);
    expect(names).toEqual(['high', 'mid', 'low']);
    const badges = [...document.querySelectorAll('.goal .badge')].map((e) => Number(e.textContent));
    expect(badges).toEqual([9, 4, 1]);
  });

  it('escapes goal names rather than injecting markup', () => {
    addGoal('<img src=x onerror=alert(1)>');
    renderWeek(new Date(2026, 0, 5));
    expect(document.querySelector('#board img')).toBeNull();
    expect(document.querySelector('.goal .nm')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('shows the empty state when every goal is deleted', () => {
    setState({ ...emptyState(), goals: [goal('gone', { deletedAt: 1 })], marks: {} });
    renderWeek(new Date(2026, 0, 5));
    expect(document.querySelector('.empty')).not.toBeNull();
    expect(document.querySelectorAll('.goal')).toHaveLength(0);
  });

  it('widens to 4 weeks on a desktop viewport', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    addGoal('X');
    renderWeek(new Date(2026, 0, 5));
    expect(document.querySelectorAll('.row.head .dh')).toHaveLength(28);
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  });
});

describe('stats view', () => {
  it('renders a 12-month window and one card per goal', () => {
    const g = addGoal('Спорт');
    toggleMark(g.id, '2026-01-02');
    renderStats(2026, 0);
    expect(document.querySelectorAll('.summary .bars.y12 .bar')).toHaveLength(12);
    expect(document.querySelectorAll('.cards .sgoal')).toHaveLength(1);
  });

  it('shows the empty state with no goals', () => {
    renderStats(2026, 0);
    expect(document.querySelector('#statsView .empty')).not.toBeNull();
  });

  it('marks the selected month as current and never exceeds 100% bar height', () => {
    setState({ ...emptyState(), goals: [goal('a')], marks: marksFor('a', 31) });
    renderStats(2026, 0);
    const bars = [...document.querySelectorAll<HTMLElement>('.summary .bar i')];
    for (const b of bars) {
      const h = parseFloat(b.style.height);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
    expect(document.querySelectorAll('.summary .bar.sel')).toHaveLength(1);
  });
});

describe('goalStatCard', () => {
  it('reports "no goal yet" for a month before the goal existed', () => {
    const g = goal('g', { created: '2026-06' });
    setState({ ...emptyState(), goals: [g], marks: {} });
    const { months, pos } = monthWindow(2026, 0, '2026-01');
    const html = goalStatCard(g, months, pos, mi(2026, 0));
    expect(html).toContain('Цели в этом месяце ещё не было');
  });

  it('flags the selected month when it is the goal\'s best', () => {
    setState({ ...emptyState(), goals: [goal('a')], marks: marksFor('a', 5, '2026-01') });
    const { months, pos } = monthWindow(2026, 0, '2026-01');
    const html = goalStatCard(visibleGoals()[0]!, months, pos, mi(2026, 0));
    expect(html).toContain('Это лучший месяц');
  });
});
