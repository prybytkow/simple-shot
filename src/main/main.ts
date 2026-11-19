import { app, BrowserWindow, Tray, Menu, ipcMain, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import {
  setupScreenCapture,
  isCaptureSessionOpen,
  isCaptureOverlayOpen,
  openHistoryReedit,
  cancelCountdownIfAny
} from './screen-capture';
import { resolveLanguage, getTranslations } from './i18n';
import {
  loadAppSettings,
  getCaptureSettings,
  setActiveProfile,
  getActiveProfile,
  needsLegacyVaultUnlock,
  isVaultLockedBlocking
} from './settings-store';
import {
  setHotkeyHandlers,
  setHotkeySettingsWindowGetter,
  registerAllHotkeys,
  unregisterAll,
  getHotkeysPayload,
  setHotkey,
  resetHotkeysToDefaults
} from './hotkeys';
import {
  setupUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdaterState
} from './updater';
import { createTrayIcon } from './app-icon';
import { registerFileUploadIpc } from './file-upload';
import { setVaultUnlockUiHandler, ensureVaultUnlockedForUpload } from './vault-flow';
import { utilityWindowOptions } from './window-defaults';
import { registerSettingsIpc } from './ipc/settings-ipc';
import { registerVaultIpc } from './ipc/vault-ipc';
import { registerHistoryIpc } from './ipc/history-ipc';

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Windows toast identity: must be set before ready. Matches electron-builder appId.
// Packaged installs show "Simple Shot"; `electron .` may still say Electron (host exe).
app.setName('Simple Shot');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.simple-shot.app');
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

let tray: Tray;
let settingsWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let uploadWindow: BrowserWindow | null = null;
let unlockWindow: BrowserWindow | null = null;
let isQuitting = false;

function getResolvedLang(): string {
  const settings = loadAppSettings();
  return resolveLanguage(settings.language || 'system', app.getLocale());
}

/** Allow re-trigger during countdown (cancels + restarts); block only if overlay/picker is up. */
function canStartCapture(): boolean {
  if (isCaptureOverlayOpen()) return false;
  cancelCountdownIfAny();
  return !isCaptureSessionOpen();
}

export function buildTrayMenu(): void {
  const t = getTranslations(getResolvedLang() as any);
  const appSettings = loadAppSettings();
  const profileItems: MenuItemConstructorOptions[] = appSettings.profiles
    .filter((p) => p.showInTray)
    .map((p) => ({
      label: p.name,
      type: 'radio' as const,
      checked: p.id === appSettings.activeProfileId,
      click: () => {
        setActiveProfile(p.id);
        buildTrayMenu();
      }
    }));

  const trayCapture = (fn: () => void) => () => {
    if (!canStartCapture()) return;
    fn();
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: t.tray_capture,
      submenu: [
        {
          label: t.tray_captureRegion || 'Region',
          click: trayCapture(() => setupScreenCapture({ mode: 'region' }))
        },
        {
          label: t.tray_captureFullscreen || 'Full screen',
          click: trayCapture(() => setupScreenCapture({ mode: 'fullscreen' }))
        },
        {
          label: t.tray_captureWindow || 'Window',
          click: trayCapture(() => setupScreenCapture({ mode: 'window' }))
        },
        {
          label: t.tray_captureDelayed || 'Delayed…',
          submenu: [
            {
              label: t.tray_delay3 || '3 seconds',
              click: trayCapture(() => {
                const mode = getCaptureSettings().defaultMode;
                setupScreenCapture({ mode, delaySeconds: 3 });
              })
            },
            {
              label: t.tray_delay5 || '5 seconds',
              click: trayCapture(() => {
                const mode = getCaptureSettings().defaultMode;
                setupScreenCapture({ mode, delaySeconds: 5 });
              })
            },
            {
              label: t.tray_delay10 || '10 seconds',
              click: trayCapture(() => {
                const mode = getCaptureSettings().defaultMode;
                setupScreenCapture({ mode, delaySeconds: 10 });
              })
            }
          ]
        }
      ]
    },
    { type: 'separator' }
  ];

  if (profileItems.length > 0) {
    template.push({ label: t.tray_profiles || 'Upload profiles', enabled: false });
    template.push(...profileItems);
    template.push({ type: 'separator' });
  }

  template.push(
    { label: t.tray_settings, click: () => createSettingsWindow() },
    { label: t.tray_history, click: () => createHistoryWindow() },
    { label: t.tray_uploadFiles || 'Upload files…', click: () => createUploadWindow() }
  );

  const updaterState = getUpdaterState();
  if (updaterState.status === 'ready') {
    template.push({
      label: t.tray_restartToUpdate || 'Restart to update',
      click: () => installUpdate()
    });
  } else if (updaterState.status === 'available') {
    template.push({
      label: (t.tray_updateAvailable || 'Update available…').replace(
        '{version}',
        updaterState.version || ''
      ),
      click: () => downloadUpdate()
    });
  } else if (updaterState.status === 'downloading') {
    template.push({
      label: (t.tray_updaterDownloading || 'Downloading update… {percent}%').replace(
        '{percent}',
        String(updaterState.downloadPercent)
      ),
      enabled: false
    });
  } else if (updaterState.status === 'checking') {
    template.push({
      label: t.tray_updaterChecking || 'Checking for updates…',
      enabled: false
    });
  } else {
    template.push({
      label: t.tray_checkUpdates || 'Check for updates',
      click: () => {
        void checkForUpdates(true);
      }
    });
  }

  if (needsLegacyVaultUnlock()) {
    template.push(
      { type: 'separator' },
      {
        label: t.tray_unlockVault || 'Unlock vault…',
        click: () => showUnlockWindow('unlock')
      }
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: t.tray_exit,
      click: () => {
        isQuitting = true;
        unregisterAll();
        app.quit();
      }
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(contextMenu);
    const active = getActiveProfile();
    const tip = active?.name ? `${t.tray_tooltip} — ${active.name}` : t.tray_tooltip;
    tray.setToolTip(tip);
  }
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  const t = getTranslations(getResolvedLang() as any);
  settingsWindow = new BrowserWindow(
    utilityWindowOptions({
      width: 880,
      height: 640,
      minWidth: 720,
      minHeight: 520,
      title: t.settings_title,
      resizable: true,
      minimizable: false,
      maximizable: false
    })
  );

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  // Profiles live inside the vault — prompt unlock when settings open locked
  if (needsLegacyVaultUnlock() || isVaultLockedBlocking()) {
    showUnlockWindow('unlock');
  }
}

function createHistoryWindow(): void {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }
  const lang = getResolvedLang();
  const t = getTranslations(lang as any);
  historyWindow = new BrowserWindow(
    utilityWindowOptions({
      width: 720,
      height: 520,
      title: t.history_title
    })
  );
  historyWindow.loadFile(path.join(__dirname, '../renderer/history.html'), { query: { lang } });
  historyWindow.on('closed', () => {
    historyWindow = null;
  });
}

function createUploadWindow(): void {
  if (uploadWindow && !uploadWindow.isDestroyed()) {
    uploadWindow.focus();
    return;
  }
  const lang = getResolvedLang();
  const t = getTranslations(lang as any);
  uploadWindow = new BrowserWindow(
    utilityWindowOptions({
      width: 520,
      height: 480,
      title: t.upload_title || 'Upload files',
      resizable: true,
      minimizable: true,
      maximizable: false
    })
  );
  uploadWindow.loadFile(path.join(__dirname, '../renderer/upload.html'), { query: { lang } });
  uploadWindow.on('closed', () => {
    uploadWindow = null;
  });
}

export type UnlockMode = 'unlock' | 'setup' | 'change';

export function showUnlockWindow(mode: UnlockMode = 'unlock'): void {
  if (unlockWindow && !unlockWindow.isDestroyed()) {
    unlockWindow.focus();
    return;
  }
  const t = getTranslations(getResolvedLang() as any);
  const titles: Record<UnlockMode, string> = {
    unlock: t.vault_unlockTitle || 'Unlock vault',
    setup: t.vault_setupTitle || 'Set master password',
    change: t.vault_changeTitle || 'Change master password'
  };
  unlockWindow = new BrowserWindow(
    utilityWindowOptions({
      width: 420,
      height: mode === 'change' ? 360 : 300,
      title: titles[mode],
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined,
      modal: !!(settingsWindow && !settingsWindow.isDestroyed())
    })
  );
  unlockWindow.loadFile(path.join(__dirname, '../renderer/unlock.html'), {
    query: { mode, lang: getResolvedLang() }
  });
  unlockWindow.on('closed', () => {
    unlockWindow = null;
  });
}

app.whenReady().then(() => {
  loadAppSettings();

  // Tray-only: no hidden BrowserWindow — stays alive via Tray + window-all-closed handler
  tray = new Tray(createTrayIcon());
  buildTrayMenu();

  tray.on('click', () => {
    if (!canStartCapture()) return;
    const cap = getCaptureSettings();
    setupScreenCapture({
      mode: cap.defaultMode,
      delaySeconds: cap.delaySeconds
    });
  });

  setVaultUnlockUiHandler(() => showUnlockWindow('unlock'));
  registerFileUploadIpc({
    ensureVaultUnlockedForUpload,
    getUploadWindowParent: () =>
      uploadWindow && !uploadWindow.isDestroyed() ? uploadWindow : null,
    getUploadWindow: () => uploadWindow
  });

  const guardCapture = (fn: () => void) => () => {
    if (!canStartCapture()) return;
    fn();
  };

  setHotkeySettingsWindowGetter(() => settingsWindow);
  setHotkeyHandlers({
    'capture.region': guardCapture(() => setupScreenCapture({ mode: 'region' })),
    'capture.fullscreen': guardCapture(() => setupScreenCapture({ mode: 'fullscreen' })),
    'capture.window': guardCapture(() => setupScreenCapture({ mode: 'window' })),
    'capture.delayed': guardCapture(() => {
      const cap = getCaptureSettings();
      const delay = cap.delaySeconds > 0 ? cap.delaySeconds : 3;
      setupScreenCapture({ mode: cap.defaultMode, delaySeconds: delay });
    }),
    'history.open': () => createHistoryWindow(),
    'settings.open': () => createSettingsWindow()
  });
  registerAllHotkeys();

  setupUpdater({
    prepareQuit: () => {
      isQuitting = true;
      unregisterAll();
    },
    onStatusChange: () => buildTrayMenu(),
    getLang: () => getResolvedLang()
  });

  registerSettingsIpc({ buildTrayMenu });
  registerVaultIpc({
    buildTrayMenu,
    showUnlockWindow,
    getSettingsWindow: () => settingsWindow,
    getUnlockWindow: () => unlockWindow
  });
  registerHistoryIpc({ openHistoryReedit });

  // Legacy master-password vault (no installTimestamp) — one-time unlock to migrate
  if (needsLegacyVaultUnlock()) {
    showUnlockWindow('unlock');
  }
});

ipcMain.handle('hotkeys-get', () => getHotkeysPayload());

ipcMain.handle('hotkeys-set', (_e, payload: { actionId: string; accelerator: string | null }) => {
  if (!payload || typeof payload.actionId !== 'string') {
    return { ok: false, error: 'invalid', current: getHotkeysPayload().current };
  }
  return setHotkey(payload.actionId, payload.accelerator ?? null);
});

ipcMain.handle('hotkeys-reset', () => resetHotkeysToDefaults());

app.on('window-all-closed', () => {
  if (!isQuitting) return;
});

app.on('before-quit', (e) => {
  if (!isQuitting) {
    console.log('[before-quit] Блокируем выход (isQuitting=false), приложение остаётся в трее');
    e.preventDefault();
  }
});

app.on('will-quit', () => {
  unregisterAll();
});
