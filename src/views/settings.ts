import { $, esc } from '../lib/dom.ts';
import { nGoals, nMarks } from '../lib/ru.ts';
import { getState, setLastBackup, setState, total, visibleGoals } from '../state/store.ts';
import { isOn, type State } from '../state/schema.ts';
import {
  backupFilename, canShareFile, downloadBackup, shareBackup,
} from '../backup/export.ts';
import { parseImport, readFileText, type ParsedImport } from '../backup/import.ts';
import { merge, previewMerge, type MergePreview } from '../backup/merge.ts';
import { estimateUsage, isPersisted, listSnapshots, putSnapshot, type Snapshot } from '../storage/idb.ts';
import { seed } from '../dev/seed.ts';
import { toast } from './toast.ts';

/** Nudge to back up once data has changed and enough time has passed. */
export const BACKUP_STALE_MS = 14 * 24 * 60 * 60 * 1000;

let pending: { parsed: ParsedImport; preview: MergePreview } | null = null;
let mode: 'merge' | 'replace' = 'merge';
let importError: string | null = null;
let persisted = false;
let usage: number | null = null;
let snaps: Snapshot[] = [];
let installHintDismissed = false;
let rerender: () => void = () => {};

export const initSettings = (onChange: () => void): void => { rerender = onChange; };

/** iOS evicts script-writable storage after ~7 days without a visit, and exempts
 *  Home-Screen apps — so this hint is a durability feature, not polish. */
const isIOS = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} Б` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} КБ` : `${(n / 1024 ** 2).toFixed(1)} МБ`;
const fmtDate = (t: number): string =>
  new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const daysSince = (t: number): number => Math.floor((Date.now() - t) / 86_400_000);

export function backupIsStale(s: State): boolean {
  if (!s.goals.length) return false;
  return !s.lastBackupAt || Date.now() - s.lastBackupAt > BACKUP_STALE_MS;
}

/** Refresh async storage facts, then re-render. */
export async function refreshStorageInfo(): Promise<void> {
  [persisted, usage, snaps] = await Promise.all([isPersisted(), estimateUsage(), listSnapshots()]);
  rerender();
}

function previewHtml(p: MergePreview, parsed: ParsedImport): string {
  const src = parsed.source === 'backup'
    ? `резервная копия (устройство ${esc(parsed.detail)})`
    : `внешний файл (${esc(parsed.detail)})`;
  const warn = parsed.warnings.length
    ? `<p class="err">${parsed.warnings.map(esc).join('<br>')}</p>` : '';
  return `<div class="prev">
      <div class="pl"><span>Источник</span><b>${src}</b></div>
      <div class="pl"><span>В файле</span><b>${p.totalIncomingGoals} ${nGoals(p.totalIncomingGoals)}, ${p.totalIncomingMarks} ${nMarks(p.totalIncomingMarks)}</b></div>
      <div class="pl"><span>Новых целей</span><b>+${p.newGoals}</b></div>
      <div class="pl"><span>Новых отметок</span><b>+${p.newMarks}</b></div>
      <div class="pl"><span>Обновится целей</span><b>${p.updatedGoals}</b></div>
      <div class="pl"><span>Расхождений</span><b>${p.conflicts}${p.conflicts ? ` (применится ${p.changedMarks})` : ''}</b></div>
      ${warn}
    </div>
    <label class="opt"><input type="radio" name="imode" value="merge" ${mode === 'merge' ? 'checked' : ''}>
      <span><span class="ot">Объединить</span><span class="od">Данные из файла добавятся к текущим. При расхождении побеждает более позднее изменение. Ничего не теряется.</span></span></label>
    <label class="opt"><input type="radio" name="imode" value="replace" ${mode === 'replace' ? 'checked' : ''}>
      <span><span class="ot">Заменить всё</span><span class="od">Текущие данные будут заменены содержимым файла. Перед заменой сохраняется точка восстановления.</span></span></label>
    <button class="btn" data-act="apply">Применить</button>
    <button class="btn" data-act="cancel">Отмена</button>`;
}

export function renderSettings(): void {
  const s = getState();
  const goals = visibleGoals();
  const markCount = Object.values(s.marks).filter(isOn).length;
  const showInstall = isIOS() && !isStandalone() && !installHintDismissed;

  let h = '';

  if (showInstall) {
    h += `<div class="nudge"><button class="x" data-act="dismiss-install" aria-label="Скрыть">×</button>
      <b>Добавьте на экран «Домой»</b>
      Safari удаляет данные сайтов, которыми не пользовались 7 дней. У приложений с экрана «Домой» данные сохраняются.
      Нажмите «Поделиться» → «На экран «Домой»».</div>`;
  }
  if (backupIsStale(s)) {
    h += `<div class="nudge"><b>Давно не было резервной копии</b>
      ${s.lastBackupAt
        ? `Последняя — ${daysSince(s.lastBackupAt)} дн. назад.`
        : 'Вы ещё ни разу не сохраняли копию.'}
      Данные хранятся только на этом устройстве.</div>`;
  }

  h += `<section class="sect">
    <h2>Резервная копия</h2>
    <p>Файл <code>${esc(backupFilename())}</code> со всеми целями и отметками. Им же данные переносятся на другое устройство.</p>
    ${canShareFile() ? '<button class="btn" data-act="share">Поделиться копией…</button>' : ''}
    <button class="btn" data-act="download">Сохранить файл</button>
    <button class="btn" data-act="import">Импорт или восстановление…</button>
    ${importError ? `<p class="err">${esc(importError)}</p>` : ''}
    ${pending ? previewHtml(pending.preview, pending.parsed) : ''}
  </section>`;

  h += `<section class="sect"><h2>Хранилище</h2>
    <p>Данные хранятся только в этом браузере. Сервера нет — копия в файле и есть ваш бэкап.</p>
    <div class="rows">
      <div class="kv"><span>Целей</span><b>${goals.length}</b></div>
      <div class="kv"><span>Отметок</span><b>${markCount}</b></div>
      <div class="kv ${persisted ? 'ok' : 'warn'}"><span>Защита от очистки</span><b>${persisted ? 'включена' : 'не гарантирована'}</b></div>
      ${usage != null ? `<div class="kv"><span>Занято</span><b>${fmtBytes(usage)}</b></div>` : ''}
      <div class="kv ${s.lastBackupAt ? '' : 'warn'}"><span>Последняя копия</span><b>${s.lastBackupAt ? fmtDate(s.lastBackupAt) : 'никогда'}</b></div>
    </div>
  </section>`;

  if (snaps.length) {
    h += `<section class="sect"><h2>Точки восстановления</h2>
      <p>Состояние перед каждым импортом. Хранятся последние ${snaps.length}.</p>
      <div class="rows">${snaps.map((sn, i) =>
        `<div class="kv"><span>${esc(sn.reason)}<br><span class="muted">${fmtDate(sn.at)}</span></span>
         <button class="btn" style="width:auto;margin:0;padding:6px 12px" data-act="restore" data-i="${i}">Вернуть</button></div>`,
      ).join('')}</div>
    </section>`;
  }

  h += `<section class="sect"><h2>Демо-данные</h2>
    <p>Заполнить приложение выдуманной историей за 13 месяцев, чтобы посмотреть, как выглядит статистика. Текущие данные будут заменены.</p>
    <button class="btn danger" data-act="seed">Загрузить демо-данные</button>
  </section>`;

  $('#setView').innerHTML = h;
}

/** Commit the pending import under the selected mode. */
async function applyImport(): Promise<void> {
  if (!pending) return;
  const { parsed } = pending;
  const before = structuredClone(getState());
  await putSnapshot(mode === 'replace' ? 'Перед заменой' : 'Перед объединением', before);

  const next = mode === 'replace'
    ? { ...parsed.state, deviceId: before.deviceId, lastBackupAt: before.lastBackupAt }
    : merge(before, parsed.state);

  pending = null;
  setState(next);
  rerender();
  void refreshStorageInfo();
  toast(mode === 'replace' ? 'Данные заменены' : 'Данные объединены', 'Отменить', () => {
    setState(before);
    rerender();
    toast('Импорт отменён');
  });
}

async function onFile(file: File): Promise<void> {
  importError = null;
  pending = null;
  try {
    const parsed = parseImport(await readFileText(file));
    if (!parsed.ok) importError = parsed.error;
    else pending = { parsed, preview: previewMerge(getState(), parsed.state) };
  } catch (e) {
    importError = e instanceof Error ? e.message : 'Не удалось прочитать файл.';
  }
  rerender();
}

async function doExport(kind: 'share' | 'download'): Promise<void> {
  const at = Date.now();
  try {
    if (kind === 'share') {
      if (!(await shareBackup(getState(), at))) return; // user cancelled
    } else {
      downloadBackup(getState(), at);
    }
    setLastBackup(at);
    rerender();
    void refreshStorageInfo();
    toast('Резервная копия создана');
  } catch {
    toast('Не удалось сохранить копию');
  }
}

export function wireSettings(): void {
  const view = $('#setView');
  const fileIn = $<HTMLInputElement>('#fileIn');

  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    fileIn.value = ''; // so re-picking the same file fires again
    if (f) void onFile(f);
  });

  view.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'imode') {
      mode = t.value === 'replace' ? 'replace' : 'merge';
    }
  });

  view.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!btn) return;
    switch (btn.dataset['act']) {
      case 'share': void doExport('share'); break;
      case 'download': void doExport('download'); break;
      case 'import': fileIn.click(); break;
      case 'apply': void applyImport(); break;
      case 'cancel': pending = null; importError = null; rerender(); break;
      case 'dismiss-install': installHintDismissed = true; rerender(); break;
      case 'restore': {
        const sn = snaps[Number(btn.dataset['i'])];
        if (!sn) return;
        const before = structuredClone(getState());
        const restored = sn.state as State;
        setState(restored);
        rerender();
        toast('Состояние восстановлено', 'Отменить', () => {
          setState(before);
          rerender();
        });
        break;
      }
      case 'seed': {
        const before = structuredClone(getState());
        setState(seed());
        rerender();
        void refreshStorageInfo();
        toast('Демо-данные загружены', 'Отменить', () => {
          setState(before);
          rerender();
          toast('Демо-данные убраны');
        });
        break;
      }
    }
  });
}

/** Reset transient UI when leaving the tab. */
export function resetSettingsUi(): void {
  pending = null;
  importError = null;
}

export const totalMarksOf = total; // re-export for convenience in tests
