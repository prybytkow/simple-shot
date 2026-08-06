import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain  } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { setupScreenCapture } from './screen-capture';
import { setupSSHHandler } from './ssh-handler';
import { getHistory } from './history';
import { resolveLanguage, getTranslations } from './i18n';

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

// Avoid Chromium color-management shifts when compositing / capturing
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Логируем необработанные ошибки (приложение может выходить из-за падения, а не app.quit)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
});

let tray: Tray;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let isQuitting = false;

interface Settings {
  saveMethod: 'ssh' | 'ftp' | 's3' | 'api';
  baseUrl: string;
  language?: string;
  watermark?: {
    enabled: boolean;
    text: string;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
    fontSize: number;
    color: string;
    opacity: number;
  };
  ssh: {
    host: string;
    port: number;
    username: string;
    password: string;
    privateKeyPath: string;
    destinationPath: string;
  };
  ftp: {
    host: string;
    port: number;
    username: string;
    password: string;
    destinationPath: string;
    secure: boolean;
  };
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region: string;
    endpoint: string;
  };
  api: {
    endpoint: string;
    apiKey: string;
  };
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

/** Скрытое окно для диалогов и чтобы приложение не завершалось при закрытии окон захвата */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}


// Загрузка настроек
export function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(data) as Partial<Settings>;
      return {
        ...defaults,
        ...parsed,
        saveMethod: parsed.saveMethod || defaults.saveMethod,
        baseUrl: parsed.baseUrl ?? defaults.baseUrl,
        language: parsed.language ?? defaults.language,
        watermark: { ...defaults.watermark!, ...parsed.watermark },
        ssh: { ...defaults.ssh, ...parsed.ssh },
        ftp: { ...defaults.ftp, ...parsed.ftp },
        s3: { ...defaults.s3, ...parsed.s3 },
        api: { ...defaults.api, ...parsed.api }
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return defaults;
}

function defaultSettings(): Settings {
  return {
    saveMethod: 'ssh',
    baseUrl: 'https://mysite.com',
    language: '',
    watermark: {
      enabled: false,
      text: '',
      position: 'bottom-right',
      fontSize: 24,
      color: '#ffffff',
      opacity: 0.5
    },
    ssh: {
      host: '',
      port: 22,
      username: '',
      password: '',
      privateKeyPath: '',
      destinationPath: '/uploads'
    },
    ftp: {
      host: '',
      port: 21,
      username: '',
      password: '',
      destinationPath: '/uploads',
      secure: false
    },
    s3: {
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      region: 'us-east-1',
      endpoint: ''
    },
    api: {
      endpoint: '',
      apiKey: ''
    }
  };
}

// Сохранение настроек
function saveSettings(settings: Settings): void {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

function getResolvedLang(): string {
  const settings = loadSettings();
  return resolveLanguage(settings.language || 'system', app.getLocale());
}

function buildTrayMenu(): void {
  const t = getTranslations(getResolvedLang() as any);
  const contextMenu = Menu.buildFromTemplate([
    { label: t.tray_capture, click: () => setupScreenCapture() },
    { label: t.tray_settings, click: () => createSettingsWindow() },
    { label: t.tray_history, click: () => createHistoryWindow() },
    { type: 'separator' },
    { label: t.tray_exit, click: () => { isQuitting = true; app.quit(); } },
  ]);
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(contextMenu);
    tray.setToolTip(t.tray_tooltip);
  }
}

// Функция для создания окна настроек
function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  const t = getTranslations(getResolvedLang() as any);
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 750,
    title: t.settings_title,
    icon: iconPath,
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
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  historyWindow = new BrowserWindow({
    width: 560,
    height: 420,
    title: t.history_title,
    icon: iconPath,
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

app.whenReady().then(() => {

    // Загружаем настройки при запуске
  const settings = loadSettings();

  // Скрытое окно, чтобы при закрытии всех окон захвата приложение не завершалось (трей-приложение)
  mainWindow = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  mainWindow.loadURL('about:blank');
  //mainWindow.webContents.openDevTools();
  // Не даём закрыть скрытое окно (чтобы приложение не завершалось после сохранения), кроме как при явном выходе из трея
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create system tray icon (на Windows лучше .ico — несколько размеров в одном файле, чётче в трее)
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(icon);
  buildTrayMenu();
  
  // Handle left click on tray
  tray.on('click', (event, bounds) => {
    setupScreenCapture();
  });
  
  // Setup SSH functionality
  setupSSHHandler();
});


// IPC обработчики для настроек
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('get-translations', (_event, lang: string) => {
  return getTranslations(resolveLanguage(lang || 'system', app.getLocale()) as any);
});

ipcMain.handle('save-settings', (event, settings: Settings) => {
  saveSettings(settings);
  buildTrayMenu();
  return { success: true };
});

ipcMain.handle('get-history', () => {
  return getHistory();
});

app.on('window-all-closed', () => {
  // Трей-приложение: не завершаться при закрытии всех окон (остаёмся в трее)
  if (!isQuitting) return;
});

// Блокируем любое завершение приложения, кроме явного «Выход» из трея (Windows может завершать при закрытии окон)
app.on('before-quit', (e) => {
  if (!isQuitting) {
    console.log('[before-quit] Блокируем выход (isQuitting=false), приложение остаётся в трее');
    e.preventDefault();
  }
});