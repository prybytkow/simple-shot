import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import { setupScreenCapture } from './screen-capture';
import { setupSSHHandler } from './ssh-handler';
import { getHistory } from './history';
import { resolveLanguage, getTranslations } from './i18n';
import {
  loadAppSettings,
  loadSettingsCompat,
  getSettingsForUi,
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
  return path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
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

  const template: MenuItemConstructorOptions[] = [
    { label: t.tray_capture, click: () => setupScreenCapture() },
    { type: 'separator' }
  ];

  if (profileItems.length > 0) {
    template.push({ label: t.tray_profiles || 'Upload profiles', enabled: false });
    template.push(...profileItems);
    template.push({ type: 'separator' });
  }

  template.push(
    { label: t.tray_settings, click: () => createSettingsWindow() },
    { label: t.tray_history, click: () => createHistoryWindow() }
  );

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
    width: 560,
    height: 420,
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

  const icon = nativeImage.createFromPath(iconFile());
  tray = new Tray(icon);
  buildTrayMenu();

  tray.on('click', () => {
    setupScreenCapture();
  });

  setupSSHHandler();

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
  activeProfileId?: string;
  profiles: UploadProfile[];
  secretsByProfile?: Record<string, any>;
}) => {
  const result = saveFromUi(payload);
  buildTrayMenu();
  if (result.needsVaultSetup) {
    showUnlockWindow('setup');
  }
  return result;
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

ipcMain.handle('get-history', () => getHistory());

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
