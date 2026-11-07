/**
 * History list / re-edit / reveal / open IPC.
 */
import { ipcMain, shell } from 'electron';
import {
  getHistoryForUi,
  deleteHistoryEntry,
  resolveReeditPath,
  resolveRevealPath,
  getHistoryEntry
} from '../history';

export interface HistoryIpcDeps {
  openHistoryReedit: (filePath: string) => { ok: boolean; error?: string };
}

let registered = false;

export function registerHistoryIpc(deps: HistoryIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle('get-history', () => getHistoryForUi());

  ipcMain.handle('history-delete', (_e, id: string) => {
    if (!id || typeof id !== 'string') return { ok: false };
    return deleteHistoryEntry(id);
  });

  ipcMain.handle('history-reedit', (_e, id: string) => {
    if (!id || typeof id !== 'string') return { ok: false, error: 'unavailable' };
    const filePath = resolveReeditPath(id);
    if (!filePath) return { ok: false, error: 'unavailable' };
    return deps.openHistoryReedit(filePath);
  });

  ipcMain.handle('history-reveal', (_e, id: string) => {
    if (!id || typeof id !== 'string') return { ok: false };
    const filePath = resolveRevealPath(id);
    if (!filePath) return { ok: false };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('history-open', async (_e, id: string) => {
    if (!id || typeof id !== 'string') return { ok: false };
    const entry = getHistoryEntry(id);
    if (!entry) return { ok: false };
    const target = entry.urlOrPath || resolveRevealPath(id);
    if (!target) return { ok: false };
    try {
      if (/^https?:\/\//i.test(target)) {
        await shell.openExternal(target);
      } else {
        await shell.openPath(target);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}
