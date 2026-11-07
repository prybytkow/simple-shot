import { app, BrowserWindow, Tray, Menu, ipcMain, MenuItemConstructorOptions, shell } from 'electron';
import * as path from 'path';
import { setupScreenCapture, isCaptureSessionOpen, openHistoryReedit } from './screen-capture';
import { setupSSHHandler } from './ssh-handler';
import {
  getHistoryForUi,
  deleteHistoryEntry,
  resolveReeditPath,
  resolveRevealPath,
  getHistoryEntry
} from './history';
import { resolveLanguage, getTranslations } from './i18n';
import {
  loadAppSettings,
  loadSettingsCompat,
  getSettingsForUi,
  getCaptureSettings,
  saveFromUi,
  setActiveProfile,
  getActiveProfile,
  unlockVault,
  lockVault,
  setupVault,
  changeVaultPassword,
  resetVault,
  isVaultLockedBlocking,
  hasVault,
  isVaultUnlocked,
  createEmptyProfile,
  UploadProfile
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
  getUpdaterState,
  refreshUpdaterSettings
} from './updater';
import { appIconPath, createTrayIcon } from './app-icon';
import { previewFileName } from './export-encode';
import { registerFileUploadIpc } from './file-upload';

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

app.commandLine.appendSwitch('force-color-profile', 'srgb');

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

let tray: Tray;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let uploadWindow: BrowserWindow | null = null;
let unlockWindow: BrowserWindow | null = null;
let isQuitting = false;

/** @deprecated use settings-store; kept for screen-capture / watermark language */
export function loadSettings() {
  return loadSettingsCompat();
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function getResolvedLang(): string {
  const settings = loadAppSettings();
  return resolveLanguage(settings.language || 'system', app.getLocale());
}

function iconFile(): string {
  return appIconPath();
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
    if (isCaptureSessionOpen()) return;
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

  if (hasVault()) {
    template.push({ type: 'separator' });
    if (isVaultUnlocked()) {
      template.push({
        label: t.tray_lockVault || 'Lock vault',
        click: () => {
          lockVault();
          buildTrayMenu();
        }
      });
    } else {
      template.push({
        label: t.tray_unlockVault || 'Unlock vault…',
        click: () => showUnlockWindow('unlock')
      });
    }
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
  settingsWindow = new BrowserWindow({
    width: 640,
    height: 820,
    title: t.settings_title,
    icon: iconFile(),
    resizable: true,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createHistoryWindow(): void {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }
  const lang = getResolvedLang();
  const t = getTranslations(lang as any);
  historyWindow = new BrowserWindow({
    width: 720,
    height: 520,
    title: t.history_title,
    icon: iconFile(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
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
  uploadWindow = new BrowserWindow({
    width: 520,
    height: 480,
    title: t.upload_title || 'Upload files',
    icon: iconFile(),
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
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
  unlockWindow = new BrowserWindow({
    width: 420,
    height: mode === 'change' ? 360 : 300,
    title: titles[mode],
    icon: iconFile(),
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : undefined,
    modal: !!(settingsWindow && !settingsWindow.isDestroyed()),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  unlockWindow.loadFile(path.join(__dirname, '../renderer/unlock.html'), {
    query: { mode, lang: getResolvedLang() }
  });
  unlockWindow.on('closed', () => {
    unlockWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.simple-shot.app');
  }

  loadAppSettings();

  mainWindow = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadURL('about:blank');
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  tray = new Tray(createTrayIcon());
  buildTrayMenu();

  tray.on('click', () => {
    if (isCaptureSessionOpen()) return;
    const cap = getCaptureSettings();
    setupScreenCapture({
      mode: cap.defaultMode,
      delaySeconds: cap.delaySeconds
    });
  });

  setupSSHHandler();
  registerFileUploadIpc({
    ensureVaultUnlockedForUpload: () => ensureVaultUnlockedForUpload(),
    getUploadWindowParent: () =>
      uploadWindow && !uploadWindow.isDestroyed()
        ? uploadWindow
        : getMainWindow(),
    getUploadWindow: () => uploadWindow
  });

  const guardCapture = (fn: () => void) => () => {
    if (isCaptureSessionOpen()) return;
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

  // Migrated plaintext secrets in memory — force vault setup so they are not lost on quit
  const ui = getSettingsForUi();
  if (ui.vault.needsSetup) {
    showUnlockWindow('setup');
  } else if (ui.vault.hasVault && !ui.vault.isUnlocked) {
    showUnlockWindow('unlock');
  }
});

ipcMain.handle('get-settings', () => getSettingsForUi());

ipcMain.handle('get-translations', (_event, lang: string) => {
  return getTranslations(resolveLanguage(lang || 'system', app.getLocale()) as any);
});

ipcMain.handle('save-settings', (_event, payload: {
  language?: string;
  afterUploadFeedback?: 'overlay' | 'notification' | 'window';
  watermark?: any;
  capture?: { defaultMode?: 'region' | 'fullscreen' | 'window'; delaySeconds?: number };
  updates?: { autoCheck?: boolean; autoDownload?: boolean };
  export?: {
    fileNameTemplate?: string;
    format?: 'png' | 'jpg' | 'webp';
    jpegQuality?: number;
    webpQuality?: number;
    defaultDestination?: 'upload' | 'file' | 'clipboard';
  };
  activeProfileId?: string;
  profiles: UploadProfile[];
  secretsByProfile?: Record<string, any>;
}) => {
  const result = saveFromUi({
    ...payload,
    capture: payload.capture
      ? {
          defaultMode:
            payload.capture.defaultMode === 'fullscreen' || payload.capture.defaultMode === 'window'
              ? payload.capture.defaultMode
              : 'region',
          delaySeconds:
            typeof payload.capture.delaySeconds === 'number' ? payload.capture.delaySeconds : 3
        }
      : undefined,
    updates: payload.updates
      ? {
          autoCheck: payload.updates.autoCheck !== false,
          autoDownload: payload.updates.autoDownload !== false
        }
      : undefined,
    export: payload.export
      ? {
          fileNameTemplate:
            typeof payload.export.fileNameTemplate === 'string' && payload.export.fileNameTemplate.trim()
              ? payload.export.fileNameTemplate.trim()
              : 'screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}',
          format:
            payload.export.format === 'jpg' || payload.export.format === 'webp'
              ? payload.export.format
              : 'png',
          jpegQuality:
            typeof payload.export.jpegQuality === 'number' ? payload.export.jpegQuality : 92,
          webpQuality:
            typeof payload.export.webpQuality === 'number' ? payload.export.webpQuality : 90,
          defaultDestination:
            payload.export.defaultDestination === 'file' ||
            payload.export.defaultDestination === 'clipboard'
              ? payload.export.defaultDestination
              : 'upload'
        }
      : undefined
  });
  refreshUpdaterSettings();
  buildTrayMenu();
  if (result.needsVaultSetup) {
    showUnlockWindow('setup');
  }
  return result;
});

ipcMain.handle('export-preview-filename', (_e, payload: { template?: string; format?: string }) => {
  const format =
    payload?.format === 'jpg' || payload?.format === 'webp' ? payload.format : 'png';
  const template =
    typeof payload?.template === 'string' && payload.template.trim()
      ? payload.template.trim()
      : 'screenshot-{yyyy}-{MM}-{dd}_{HH}-{mm}-{ss}';
  return previewFileName(template, format);
});

ipcMain.handle('create-empty-profile', (_e, name?: string) => {
  return createEmptyProfile(name || 'New profile');
});

ipcMain.handle('set-active-profile', (_e, id: string) => {
  const ok = setActiveProfile(id);
  buildTrayMenu();
  return { success: ok };
});

ipcMain.handle('vault-status', () => {
  const ui = getSettingsForUi();
  return ui.vault;
});

ipcMain.handle('vault-unlock', (_e, password: string) => {
  const result = unlockVault(password || '');
  buildTrayMenu();
  if (result.ok) {
    registerAllHotkeys();
  }
  if (result.ok && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('vault-updated');
  }
  return result;
});

ipcMain.handle('vault-setup', (_e, password: string) => {
  const result = setupVault(password || '');
  buildTrayMenu();
  if (result.ok && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('vault-updated');
  }
  return result;
});

ipcMain.handle('vault-change-password', (_e, oldPassword: string, newPassword: string) => {
  const result = changeVaultPassword(oldPassword || '', newPassword || '');
  buildTrayMenu();
  return result;
});

ipcMain.handle('vault-lock', () => {
  lockVault();
  buildTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('vault-updated');
  }
  return { ok: true };
});

ipcMain.handle('vault-reset', () => {
  resetVault();
  buildTrayMenu();
  registerAllHotkeys();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('vault-updated');
  }
  return { ok: true };
});

ipcMain.handle('show-vault-window', (_e, mode: UnlockMode) => {
  showUnlockWindow(mode || 'unlock');
  return { ok: true };
});

ipcMain.handle('close-unlock-window', () => {
  if (unlockWindow && !unlockWindow.isDestroyed()) unlockWindow.close();
  return { ok: true };
});

ipcMain.handle('get-history', () => getHistoryForUi());

ipcMain.handle('history-delete', (_e, id: string) => {
  if (!id || typeof id !== 'string') return { ok: false };
  return deleteHistoryEntry(id);
});

ipcMain.handle('history-reedit', (_e, id: string) => {
  if (!id || typeof id !== 'string') return { ok: false, error: 'unavailable' };
  const filePath = resolveReeditPath(id);
  if (!filePath) return { ok: false, error: 'unavailable' };
  return openHistoryReedit(filePath);
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

ipcMain.handle('hotkeys-get', () => getHotkeysPayload());

ipcMain.handle('hotkeys-set', (_e, payload: { actionId: string; accelerator: string | null }) => {
  if (!payload || typeof payload.actionId !== 'string') {
    return { ok: false, error: 'invalid', current: getHotkeysPayload().current };
  }
  return setHotkey(payload.actionId, payload.accelerator ?? null);
});

ipcMain.handle('hotkeys-reset', () => resetHotkeysToDefaults());

export function ensureVaultUnlockedForUpload(): boolean {
  if (!isVaultLockedBlocking()) return true;
  showUnlockWindow('unlock');
  return false;
}

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
