import { detectAdapter } from '../import/adapters/index.ts';
import { canonicalToState } from '../import/canonical.ts';
import { migrate, SCHEMA_VERSION, type State } from '../state/schema.ts';
import { BACKUP_FORMAT } from './export.ts';

export type ImportSource = 'backup' | 'external';

export interface ParsedImport {
  ok: true;
  source: ImportSource;
  /** adapter name for external files, or the exporting deviceId for backups */
  detail: string;
  state: State;
  warnings: string[];
}
export interface ParseError { ok: false; error: string }

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * One pipeline for both our own backups and external source files: whatever the
 * shape, it ends up as a State that goes through the same preview -> merge path.
 */
export function parseImport(text: string): ParsedImport | ParseError {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON.' };
  }

  if (isObj(json) && json['format'] === BACKUP_FORMAT) {
    const version = json['version'];
    if (typeof version !== 'number') return { ok: false, error: 'В резервной копии нет версии.' };
    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Копия создана более новой версией приложения (${version}). Обновите приложение.`,
      };
    }
    const data = isObj(json['data']) ? json['data'] : {};
    const state = migrate({ v: version, deviceId: json['deviceId'], ...data });
    if (!state) return { ok: false, error: 'Не удалось прочитать данные из копии.' };
    const warnings: string[] = [];
    if (!state.goals.length) warnings.push('В копии нет целей');
    return {
      ok: true,
      source: 'backup',
      detail: typeof json['deviceId'] === 'string' ? json['deviceId'].slice(0, 6) : '—',
      state,
      warnings,
    };
  }

  // Not one of ours — try the external-source adapters.
  const adapter = detectAdapter(json);
  if (!adapter) {
    return {
      ok: false,
      error: 'Формат файла не распознан. Ожидается резервная копия или {"goals":[{"name":…,"dates":[…]}]}.',
    };
  }
  const { state, warnings } = canonicalToState(adapter.toCanonical(json));
  if (!state.goals.length) {
    return { ok: false, error: 'В файле не найдено ни одной цели с названием.' };
  }
  return { ok: true, source: 'external', detail: adapter.name, state, warnings };
}

export async function readFileText(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл слишком большой (больше 25 МБ).');
  return await file.text();
}
