import { key } from '../lib/date.ts';
import { SCHEMA_VERSION, type State } from '../state/schema.ts';

export const BACKUP_FORMAT = 'goal-tracker.backup';

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof SCHEMA_VERSION;
  exportedAt: number;
  deviceId: string;
  data: { goals: State['goals']; marks: State['marks'] };
}

export function buildBackup(s: State, at = Date.now()): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: at,
    deviceId: s.deviceId,
    data: { goals: s.goals, marks: s.marks },
  };
}

export const backupFilename = (at = Date.now()): string =>
  `goal-tracker-${key(new Date(at))}.json`;

const blobOf = (s: State, at: number): Blob =>
  new Blob([JSON.stringify(buildBackup(s, at), null, 2)], { type: 'application/json' });

/** Can this device hand the file to another app (AirDrop, Files, Telegram)? */
export function canShareFile(): boolean {
  try {
    const f = new File(['{}'], 'probe.json', { type: 'application/json' });
    return !!navigator.canShare?.({ files: [f] });
  } catch { return false; }
}

/** Share sheet — on iOS a far better device-to-device path than a download
 *  that lands in Safari's Downloads folder. Resolves false if the user cancels. */
export async function shareBackup(s: State, at = Date.now()): Promise<boolean> {
  const file = new File([blobOf(s, at)], backupFilename(at), { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'Трекер целей — резервная копия' });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

export function downloadBackup(s: State, at = Date.now()): void {
  const url = URL.createObjectURL(blobOf(s, at));
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename(at);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
