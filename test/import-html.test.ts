import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain .mjs tool, no type declarations
import { parsePage, toImport, indexByName, resolveIds } from '../tools/import-from-html.mjs';
import { parseImport } from '../src/backup/import.ts';
import { merge, previewMerge } from '../src/backup/merge.ts';
import { buildBackup } from '../src/backup/export.ts';
import { emptyState, isOn, makeGoal, markKey } from '../src/state/schema.ts';

/** A month page in the source's shape: `days` are the cells with data-on="1". */
const page = (n: number, y: number, rows: [string, string, number[]][], extra = '') => `
<table class="cal"><thead><tr><td class="thismonth">
<span id="month" data-n="${n}" data-y="${y}">месяц</span></td></tr></thead><tbody>
${rows.map(([tag, name, days], ri) => `<tr>
<td><div class="task hand c0" id="tag${tag}" title="Правая кнопка - перекрасить" data-tag="${tag}">
<span class="hand trash hidden"><a href="/do.php?action=removehabit&amp;id=${tag}"><img src="/icon/trash.gif" title="Удалить"></a></span>
<span class="tip lock" data-html="1" data-title="&lt;img src=/icon/lock-open.gif&gt; показывать друзьям"><img src="/icon/lock-closed.gif"></span>
<span class="pcs"><div class="silk silk4"></div></span>
${name}
</div></td>
${Array.from({ length: 31 }, (_, i) => `<td class="cald"><div id="ib${i + 1}_${ri + 1}" class="tip
imgbox ${days.includes(i + 1) ? 'con c0' : 'coff'} " data-on="${days.includes(i + 1) ? 1 : 0}"
data-tag="${tag}" data-j="${i + 1}" data-title=""></div></td>`).join('')}
${extra}
</tr>`).join('')}
<tr><td><form class="addtask"><input name="name" placeholder="Новая активность"></form></td>
<td colspan="29"><span class="score" id="score" data-total="279">283</span></td></tr>
</tbody></table>`;

const AUG = page(8, 2026, [
  ['698d069764550e997593b2d5', 'Спорт и здоровье', [2, 3, 31]],
  ['5549dd9c321854ec5c8748c3', 'Музыка', [24]],
]);

describe('parsePage', () => {
  it('reads names, tags and the days that are on', () => {
    const rows = parsePage(AUG);
    expect(rows).toEqual([
      { id: '698d069764550e997593b2d5', name: 'Спорт и здоровье', month: '2026-08',
        dates: ['2026-08-02', '2026-08-03', '2026-08-31'] },
      { id: '5549dd9c321854ec5c8748c3', name: 'Музыка', month: '2026-08',
        dates: ['2026-08-24'] },
    ]);
  });

  it('ignores the trailing "add activity" row', () => {
    expect(parsePage(AUG)).toHaveLength(2);
  });

  it('takes the month from the hidden form fields when the header span is gone', () => {
    const html = AUG.replace(/<span id="month"[^>]*>[^<]*<\/span>/, '') +
      '<input type="hidden" name="n" value="8"><input type="hidden" name="y" value="2026">';
    const warnings: string[] = [];
    expect(parsePage(html, (w: string) => warnings.push(w))[0].dates[0]).toBe('2026-08-02');
    expect(warnings.join(' ')).toContain('форм');
  });

  it('refuses a page with no month at all', () => {
    expect(() => parsePage('<table class="cal"><tbody></tbody></table>')).toThrow(/месяц/);
  });

  it('drops cells outside the month and cells tagged to another goal, with a warning', () => {
    const warnings: string[] = [];
    const html = page(2, 2026, [['aaa', 'X', [1]]],
      '<td class="cald"><div data-on="1" data-tag="aaa" data-j="30"></div></td>' +
      '<td class="cald"><div data-on="1" data-tag="bbb" data-j="5"></div></td>');
    const rows = parsePage(html, (w: string) => warnings.push(w));
    expect(rows[0].dates).toEqual(['2026-02-01']);      // 2026 is not a leap year
    expect(warnings.join(' ')).toContain('день 30 вне');
    expect(warnings.join(' ')).toContain('чужой цели bbb');
  });

  it('warns on a page with no activities', () => {
    const warnings: string[] = [];
    parsePage(page(8, 2026, []), (w: string) => warnings.push(w));
    expect(warnings.join(' ')).toContain('ни одной активности');
  });
});

describe('toImport', () => {
  it('produces the documented external-import shape', () => {
    expect(toImport([parsePage(AUG)]).goals[0]).toEqual({
      id: '698d069764550e997593b2d5',
      name: 'Спорт и здоровье',
      created: '2026-08',
      dates: ['2026-08-02', '2026-08-03', '2026-08-31'],
    });
  });

  it('merges several months into one goal, keyed by data-tag', () => {
    const jul = page(7, 2026, [['698d069764550e997593b2d5', 'Спорт и здоровье', [30]]]);
    const out = toImport([parsePage(AUG), parsePage(jul)]);
    expect(out.goals).toHaveLength(2);
    expect(out.goals[0]!.created).toBe('2026-07');
    expect(out.goals[0]!.dates).toEqual(['2026-07-30', '2026-08-02', '2026-08-03', '2026-08-31']);
  });

  it('warns when the same tag carries two names, keeping the first', () => {
    const renamed = page(9, 2026, [['698d069764550e997593b2d5', 'Спорт', [1]]]);
    const warnings: string[] = [];
    const out = toImport([parsePage(AUG), parsePage(renamed)], (w: string) => warnings.push(w));
    expect(out.goals[0]!.name).toBe('Спорт и здоровье');
    expect(warnings.join(' ')).toContain('«Спорт и здоровье», и «Спорт»');
  });
});

describe('--against: matching rows onto existing goals by name', () => {
  const backup = (...goals: { id: string; name: string; deletedAt?: number }[]) => ({
    data: { goals: goals.map((g) => ({ created: '2026-01', createdAt: 1, updatedAt: 1, ...g })), marks: {} },
  });

  it('re-keys a row onto the id of the goal with that name', () => {
    const out = toImport([parsePage(AUG)]);
    const report = resolveIds(out, indexByName(backup({ id: 'mine00000001', name: 'Спорт и здоровье' })));
    expect(out.goals[0]!.id).toBe('mine00000001');
    expect(out.goals[1]!.id).toBe('5549dd9c321854ec5c8748c3'); // unmatched: keeps data-tag
    expect(report).toEqual([
      { name: 'Спорт и здоровье', id: 'mine00000001', matched: true },
      { name: 'Музыка', id: '5549dd9c321854ec5c8748c3', matched: false },
    ]);
  });

  it('ignores case, outer space and repeated spaces', () => {
    const out = toImport([parsePage(AUG)]);
    resolveIds(out, indexByName(backup({ id: 'mine00000001', name: '  спорт  И  ЗДОРОВЬЕ ' })));
    expect(out.goals[0]!.id).toBe('mine00000001');
  });

  it('does not match on a substring or a near miss', () => {
    const out = toImport([parsePage(page(8, 2026, [['tag1', 'Чтение', [1]]]))]);
    resolveIds(out, indexByName(backup({ id: 'mine00000001', name: 'Развитие через чтение' })));
    expect(out.goals[0]!.id).toBe('tag1');
  });

  it('skips a name carried by two live goals rather than picking one', () => {
    const warnings: string[] = [];
    const idx = indexByName(
      backup({ id: 'a00000000001', name: 'Спорт и здоровье' }, { id: 'b00000000002', name: 'спорт и здоровье' }),
      (w: string) => warnings.push(w));
    const out = toImport([parsePage(AUG)]);
    resolveIds(out, idx);
    expect(out.goals[0]!.id).toBe('698d069764550e997593b2d5');
    expect(warnings.join(' ')).toContain('две цели');
  });

  it('does not reuse the id of a deleted goal, which would undelete it', () => {
    const out = toImport([parsePage(AUG)]);
    resolveIds(out, indexByName(backup({ id: 'mine00000001', name: 'Спорт и здоровье', deletedAt: 5 })));
    expect(out.goals[0]!.id).toBe('698d069764550e997593b2d5');
  });

  it('refuses a file that is not an app backup', () => {
    expect(() => indexByName({ nope: true })).toThrow(/goals/);
  });

  it('reads a real backup file, and the result merges into the existing goal', () => {
    const mine = { ...makeGoal('Спорт и здоровье'), id: 'mine00000001' };
    const local = { ...emptyState(), goals: [mine], marks: {} };

    const out = toImport([parsePage(AUG)]);
    resolveIds(out, indexByName(buildBackup(local)));
    const r = parseImport(JSON.stringify(out));
    if (!r.ok) throw new Error('parse failed');

    const merged = merge(local, r.state);
    expect(merged.goals.filter((g) => g.name === 'Спорт и здоровье')).toHaveLength(1); // no duplicate
    expect(isOn(merged.marks[markKey('mine00000001', '2026-08-03')])).toBe(true);
    expect(merged.goals.find((g) => g.id === 'mine00000001')!.created).toBe('2026-08'); // backdated
  });
});

describe('the output feeds the app import pipeline', () => {
  const json = () => JSON.stringify(toImport([parsePage(AUG)]));

  it('is accepted by the canonical adapter and marks the right days', () => {
    const r = parseImport(json());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('external');
    expect(r.detail).toBe('canonical');
    expect(r.state.goals.map((g) => g.name)).toEqual(['Спорт и здоровье', 'Музыка']);
    expect(isOn(r.state.marks[markKey('698d069764550e997593b2d5', '2026-08-03')])).toBe(true);
    expect(r.state.marks[markKey('698d069764550e997593b2d5', '2026-08-04')]).toBeUndefined();
    expect(Object.keys(r.state.marks)).toHaveLength(4);
  });

  it('keeps the source ids, so importing the same file twice adds nothing', () => {
    const a = parseImport(json()), b = parseImport(json());
    if (!a.ok || !b.ok) throw new Error('parse failed');
    // updatedGoals is not asserted: makeGoal stamps updatedAt at parse time.
    expect(previewMerge(a.state, b.state)).toMatchObject({ newGoals: 0, newMarks: 0, conflicts: 0 });
  });
});
