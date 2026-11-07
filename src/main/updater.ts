/**
 * Auto-update via electron-updater (GitHub Releases).
 * No-ops safely in unpackaged / network-failure cases so capture keeps working.
 */
import { app, ipcMain, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { getUpdatesSettings, loadAppSettings } from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';
import { showAppNotification } from './app-notify';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'not-available';

export interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  downloadPercent: number;
  lastError: string | null;
}

type UpdaterHooks = {
  /** Mark app as quitting so before-quit does not block quitAndInstall */
  prepareQuit: () => void;
  /** Rebuild tray when status changes */
  onStatusChange: () => void;
  getLang: () => string;
};

let hooks: UpdaterHooks | null = null;
let state: UpdaterState = {
  status: 'idle',
  version: null,
  downloadPercent: 0,
  lastError: null
};
let started = false;
let progressNotifyAt = 0;

function t() {
  const lang = hooks?.getLang() || resolveLanguage(loadAppSettings().language || 'system', app.getLocale());
  return getTranslations(lang as any);
}

function setState(partial: Partial<UpdaterState>): void {
  state = { ...state, ...partial };
  broadcastStatus();
  hooks?.onStatusChange();
}

function broadcastStatus(): void {
  const payload = { ...state };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('updater-status', payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function showNotify(title: string, body: string, onClick?: () => void): void {
  showAppNotification({ title, body, onClick });
}

function applyDownloadPreference(): void {
  const updates = getUpdatesSettings();
  autoUpdater.autoDownload = updates.autoDownload;
  autoUpdater.autoInstallOnAppQuit = true;
}

export function getUpdaterState(): UpdaterState {
  return { ...state };
}

export function isUpdateReady(): boolean {
  return state.status === 'ready';
}

export function isUpdateAvailable(): boolean {
  return state.status === 'available' || state.status === 'downloading' || state.status === 'ready';
}

/** Install downloaded update (sets quitting flag first). */
export function installUpdate(): void {
  if (state.status !== 'ready') return;
  try {
    hooks?.prepareQuit();
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    console.error('[updater] quitAndInstall failed', e);
    setState({ status: 'error', lastError: String(e) });
  }
}

/** Download when autoDownload is disabled and an update is available. */
export function downloadUpdate(): void {
  if (state.status !== 'available' || !app.isPackaged) return;
  setState({ status: 'downloading', downloadPercent: 0 });
  void autoUpdater.downloadUpdate().catch((e) => {
    console.error('[updater] download failed', e);
    setState({ status: 'error', lastError: String(e) });
  });
}

/** Manual or scheduled check. Safe when unpackaged / offline. */
export async function checkForUpdates(manual = false): Promise<UpdaterState> {
  if (!app.isPackaged) {
    setState({ status: 'idle', lastError: null });
    if (manual) {
      const tr = t();
      showNotify(
        tr.notify_updateDevTitle || 'Updates',
        tr.notify_updateDevBody || 'Auto-update runs only in packaged builds.'
      );
    }
    return getUpdaterState();
  }

  applyDownloadPreference();
  setState({ status: 'checking', lastError: null });

  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      setState({ status: 'not-available' });
      if (manual) {
        const tr = t();
        showNotify(
          tr.notify_updateUpToDateTitle || 'Up to date',
          tr.notify_updateUpToDateBody || 'You are running the latest version.'
        );
      }
      setTimeout(() => {
        if (state.status === 'not-available') setState({ status: 'idle' });
      }, 2000);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[updater] check failed', e);
    setState({ status: 'error', lastError: msg });
    if (manual) {
      const tr = t();
      showNotify(
        tr.notify_updateErrorTitle || 'Update check failed',
        tr.notify_updateErrorBody || msg
      );
    }
    setTimeout(() => {
      if (state.status === 'error') setState({ status: 'idle', lastError: msg });
    }, 4000);
  }

  return getUpdaterState();
}

function wireEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', lastError: null });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({ status: 'available', version: info.version, downloadPercent: 0 });
    const tr = t();
    showNotify(
      tr.notify_updateAvailableTitle || 'Update available',
      (tr.notify_updateAvailableBody || 'Version {version} is available.').replace(
        '{version}',
        info.version
      )
    );
  });

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'not-available', version: null });
    setTimeout(() => {
      if (state.status === 'not-available') setState({ status: 'idle' });
    }, 2000);
  });

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const percent = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
    setState({ status: 'downloading', downloadPercent: percent });
    // Throttle progress notifications (~25% steps)
    if (percent >= progressNotifyAt + 25 || percent >= 99) {
      progressNotifyAt = percent >= 99 ? 100 : Math.floor(percent / 25) * 25;
      const tr = t();
      showNotify(
        tr.notify_updateDownloadingTitle || 'Downloading update',
        (tr.notify_updateDownloadingBody || '{percent}%').replace('{percent}', String(percent))
      );
    }
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    progressNotifyAt = 0;
    setState({ status: 'ready', version: info.version, downloadPercent: 100 });
    const tr = t();
    showNotify(
      tr.notify_updateReadyTitle || 'Update ready',
      (tr.notify_updateReadyBody || 'Version {version} downloaded. Restart to install.').replace(
        '{version}',
        info.version
      ),
      () => installUpdate()
    );
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] error', err);
    setState({ status: 'error', lastError: err?.message || String(err) });
    const tr = t();
    showNotify(
      tr.notify_updateErrorTitle || 'Update error',
      tr.notify_updateErrorBody || err?.message || String(err)
    );
    setTimeout(() => {
      if (state.status === 'error') setState({ status: 'idle' });
    }, 5000);
  });
}

function registerIpc(): void {
  ipcMain.handle('updater-check', async () => {
    return checkForUpdates(true);
  });

  ipcMain.handle('updater-status', () => getUpdaterState());

  ipcMain.handle('updater-install', () => {
    installUpdate();
    return { ok: true };
  });
}

/**
 * Call once after app.whenReady. Schedules quiet check when autoCheck is on.
 */
export function setupUpdater(h: UpdaterHooks): void {
  if (started) return;
  started = true;
  hooks = h;

  autoUpdater.logger = {
    info: (...args: unknown[]) => console.log('[updater]', ...args),
    warn: (...args: unknown[]) => console.warn('[updater]', ...args),
    error: (...args: unknown[]) => console.error('[updater]', ...args),
    debug: (...args: unknown[]) => console.debug('[updater]', ...args)
  };

  applyDownloadPreference();
  wireEvents();
  registerIpc();

  const updates = getUpdatesSettings();
  if (updates.autoCheck && app.isPackaged) {
    setTimeout(() => {
      void checkForUpdates(false);
    }, 8000);
  }
}

/** Re-apply autoDownload after settings change. */
export function refreshUpdaterSettings(): void {
  if (!started) return;
  applyDownloadPreference();
}
