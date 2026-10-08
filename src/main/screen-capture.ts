import { app, BrowserWindow, screen, ipcMain, desktopCapturer, clipboard, dialog, Notification, shell, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { addToHistory } from './history';
import { S3Uploader } from './uploaders/s3-uploader';
import { FTPUploader } from './uploaders/ftp-uploader';
import { SSHUploader } from './uploaders/ssh-uploader';
import { ApiUploader } from './uploaders/api-uploader';

import { loadSettings, getMainWindow, ensureVaultUnlockedForUpload } from './main';
import { getRuntimeUploadSettings, loadAppSettings } from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';

type AfterUploadFeedback = 'overlay' | 'notification' | 'window';

function getAfterUploadFeedback(settings?: { afterUploadFeedback?: string }): AfterUploadFeedback {
  const f = settings?.afterUploadFeedback ?? loadAppSettings().afterUploadFeedback;
  if (f === 'notification' || f === 'window') return f;
  return 'overlay';
}

function showUploadNotification(url: string): void {
  if (!Notification.isSupported()) return;
  const settings = loadAppSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  const t = getTranslations(lang);
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
  const n = new Notification({
    title: t.notify_linkCopiedTitle || 'Link copied',
    body: url,
    icon: icon && !icon.isEmpty() ? icon : undefined,
    silent: false
  });
  n.on('click', () => {
    shell.openExternal(url).catch(() => {});
  });
  n.show();
}

function replyUploadComplete(
  event: Electron.IpcMainEvent,
  payload: {
    success: boolean;
    path?: string;
    url?: string;
    error?: string;
    saveLocally: boolean;
  },
  settings?: { afterUploadFeedback?: string }
): void {
  const feedback = getAfterUploadFeedback(settings);
  event.reply('upload-complete', { ...payload, feedback });
  if (payload.success && !payload.saveLocally && payload.url && feedback === 'notification') {
    showUploadNotification(payload.url);
  }
}

ipcMain.on('copy-text', (_event, text: string) => {
  if (typeof text === 'string' && text) clipboard.writeText(text);
});

let overlayWindows: BrowserWindow[] = [];
let activeWindow: BrowserWindow | null = null;
const pendingWatermark: Map<number, { saveLocally: boolean; fileName: string; settings: any }> = new Map();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Hide overlays so they are not included in the framebuffer capture. */
async function hideOverlaysForCapture(): Promise<void> {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(0);
      win.hide();
    }
  }
  // Let the compositor drop the overlay from the desktop image
  await sleep(80);
}

/** Show overlays again after a Linux capture so upload feedback still has a window. */
async function restoreOverlaysAfterCapture(): Promise<void> {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(1);
      win.show();
      win.setAlwaysOnTop(true);
    }
  }
}

/** Wayland close() of a transparent overlay can SIGTRAP. Hide, then destroy on the next turn. */
function closeCaptureWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (process.platform === 'linux') {
    win.hide();
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, 0);
    return;
  }
  win.close();
}

async function captureScreenshot(areaData: any, sourceDisplayId?: number): Promise<Buffer> {
  const { x, y, width, height } = areaData;

  console.log(`📱 Capture area: ${x},${y} ${width}x${height} from display: ${sourceDisplayId}`);

  const displays = screen.getAllDisplays();
  let targetDisplay = displays[0];

  if (sourceDisplayId !== undefined) {
    const foundDisplay = displays.find(display => display.id === sourceDisplayId);
    if (foundDisplay) {
      targetDisplay = foundDisplay;
    } else {
      console.warn(`Display with id ${sourceDisplayId} not found, using primary display`);
    }
  }

  console.log(`Target display:`, {
    id: targetDisplay.id,
    bounds: targetDisplay.bounds,
    scaleFactor: targetDisplay.scaleFactor
  });

  // DIP (overlay-local) → absolute DIP on the virtual desktop → physical screen pixels
  const dipRect = {
    x: targetDisplay.bounds.x + x,
    y: targetDisplay.bounds.y + y,
    width,
    height
  };
  const physRect = screen.dipToScreenRect(null, dipRect);

  console.log(`Physical capture rect:`, physRect);

  if (process.platform === 'win32') {
    try {
      await hideOverlaysForCapture();
      const { captureRegionGdi } = require('./gdi-capture') as typeof import('./gdi-capture');
      const png = captureRegionGdi(physRect.x, physRect.y, physRect.width, physRect.height);
      console.log(`✅ GDI capture ${physRect.width}x${physRect.height}`);
      return png;
    } catch (err) {
      console.warn('GDI capture failed, falling back to desktopCapturer:', err);
    }
  }

  if (process.platform === 'linux') {
    const linux = require('./linux-screen-capture') as typeof import('./linux-screen-capture');
    await hideOverlaysForCapture();
    try {
      if (linux.isWaylandSession()) {
        try {
          // hideOverlays already waited 80ms; Wayland compositors need a little longer
          await sleep(170);
          const png = await linux.captureRegionLinux(
            { x, y, width, height },
            targetDisplay,
            displays
          );
          console.log(`✅ Portal capture ${width}x${height}`);
          return png;
        } catch (err) {
          console.warn('Portal capture failed, falling back to desktopCapturer:', err);
        }
      }
      return await captureScreenshotDesktopCapturer(areaData, targetDisplay);
    } finally {
      await restoreOverlaysAfterCapture();
    }
  }

  return captureScreenshotDesktopCapturer(areaData, targetDisplay);
}

async function captureScreenshotDesktopCapturer(
  areaData: { x: number; y: number; width: number; height: number },
  targetDisplay: Electron.Display
): Promise<Buffer> {
  const { x, y, width, height } = areaData;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(targetDisplay.bounds.width * targetDisplay.scaleFactor),
      height: Math.round(targetDisplay.bounds.height * targetDisplay.scaleFactor)
    }
  });

  if (sources.length === 0) {
    throw new Error('No screens found');
  }

  let screenSource = sources.find(source => {
    const displayId = source.display_id || (source as any).id;
    return displayId === targetDisplay.id.toString();
  });

  if (!screenSource) {
    screenSource = sources[0];
    console.log('Using first available screen source');
  }

  if (!screenSource.thumbnail) {
    throw new Error('No thumbnail available');
  }

  const fullScreenshot = screenSource.thumbnail;
  const scaleFactor = targetDisplay.scaleFactor;
  const adjustedX = Math.round(x * scaleFactor);
  const adjustedY = Math.round(y * scaleFactor);
  const adjustedWidth = Math.round(width * scaleFactor);
  const adjustedHeight = Math.round(height * scaleFactor);

  const screenshotSize = fullScreenshot.getSize();
  const finalX = Math.max(0, Math.min(adjustedX, screenshotSize.width - 1));
  const finalY = Math.max(0, Math.min(adjustedY, screenshotSize.height - 1));
  const finalWidth = Math.max(1, Math.min(adjustedWidth, screenshotSize.width - finalX));
  const finalHeight = Math.max(1, Math.min(adjustedHeight, screenshotSize.height - finalY));

  const croppedImage = fullScreenshot.crop({
    x: finalX,
    y: finalY,
    width: finalWidth,
    height: finalHeight
  });

  return croppedImage.toPNG();
}

export function setupScreenCapture(): void {
  // Закрываем предыдущие окна если есть
  closeAllCaptureWindows();

  activeWindow = null;

  const displays = screen.getAllDisplays();
  const settings = loadSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  
  // Создаем отдельное окно для каждого экрана
  displays.forEach((display, index) => {
    const scaleFactor = display.scaleFactor;
    // bounds в DIP (device-independent pixels) — размер окна задаём в DIP, без деления на scaleFactor
    const width = display.bounds.width;
    const height = display.bounds.height;
    
    
    const overlayWindow = new BrowserWindow({
      width: width,
      height: height,
      x: display.bounds.x,
      y: display.bounds.y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      movable: true,
      fullscreen: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // Не вызываем maximize() — окно должно покрывать весь дисплей включая панель задач Windows
    // overlayWindow.maximize();

    // Сохраняем ID дисплея
    (overlayWindow as any).displayId = display.id;


    // Передаем ID экрана и информацию о масштабировании в HTML
    const htmlPath = path.join(__dirname, '../renderer/capture-window.html');
    overlayWindow.loadFile(htmlPath, {
      query: { 
        screenId: index.toString(),
        totalScreens: displays.length.toString(),
        scaleFactor: scaleFactor.toString(),
        actualWidth: display.bounds.width.toString(),
        actualHeight: display.bounds.height.toString(),
        displayId: display.id.toString(),
        lang
      }
    });

    // Для отладки - выводим информацию о дисплее
    console.log(`Display ${index}:`, {
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      windowSize: { width, height },
      displayId: display.id
    });

    overlayWindow.setIgnoreMouseEvents(false);
    overlayWindows.push(overlayWindow);

    // После загрузки страницы принудительно задаём границы окна и контента по полному экрану (bounds),
    // чтобы на Windows окно точно покрывало панель задач (не work area)
    const displayBounds = { ...display.bounds };
    overlayWindow.webContents.once('did-finish-load', () => {
      if (overlayWindow.isDestroyed()) return;
      overlayWindow.setBounds(displayBounds);
      overlayWindow.setContentBounds(displayBounds);
      overlayWindow.setAlwaysOnTop(true);
      if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
      // Повторно через 200 ms — Windows иногда применяет work area при первом показе
      setTimeout(() => {
        if (!overlayWindow.isDestroyed()) {
          overlayWindow.setBounds(displayBounds);
          overlayWindow.setContentBounds(displayBounds);
          overlayWindow.setAlwaysOnTop(true);
          if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
        }
      }, 200);
    });

    // Обработчик закрытия окна
    overlayWindow.on('closed', () => {
      overlayWindows = overlayWindows.filter(win => !win.isDestroyed());
        // Если закрыто активное окно, сбрасываем его
       if (activeWindow === overlayWindow) {
        activeWindow = null;
      }
    });

    // При получении фокуса снова поднимаем окно поверх остальных (браузер и др.)
    overlayWindow.on('focus', () => {
      if (!overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(true);
        if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
      }
    });

    // Добавляем глобальный обработчик клавиши Esc
    overlayWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        hideAllCaptureWindows();
        event.preventDefault();
      }
    });
  });
}

// Скрыть окна захвата (не закрывать), чтобы приложение не завершалось на Windows при уничтожении окна
function hideAllCaptureWindows(): void {
  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      win.hide();
    }
  });
  activeWindow = null;
}

// Функция для закрытия всех окон захвата (уничтожить — вызывается при новом захвате или ESC)
export function closeAllCaptureWindows(): void {
  overlayWindows.forEach(win => closeCaptureWindow(win));
  overlayWindows = [];
  activeWindow = null;
}

// Обработчик для активации одного окна и закрытия остальных
ipcMain.on('activate-single-window', (event, screenId) => {
  console.log(`Активируем окно ${screenId}, закрываем остальные`);

   // Находим активируемое окно
  activeWindow = overlayWindows.find(win => {
    const winUrl = win.webContents.getURL();
    return winUrl.includes(`screenId=${screenId}`);
  }) || null;

  if (activeWindow) {
    console.log(`Active window display ID: ${(activeWindow as any).displayId}`);
  }
  
  overlayWindows.forEach(win => {
    if (!win.isDestroyed()) {
      // Закрываем все окна кроме активированного
      const winScreenId = win.webContents.getURL().includes(`screenId=${screenId}`);
    //  win.webContents.openDevTools();
      if (!winScreenId) {
        closeCaptureWindow(win);
      }
    }
  });
  
  // Обновляем массив окон
  overlayWindows = overlayWindows.filter(win => !win.isDestroyed());
});

// Обработчик IPC: после сохранения/загрузки только скрываем окна (не закрываем), чтобы приложение не выходило
ipcMain.on('close-all-windows', () => {
  setTimeout(() => hideAllCaptureWindows(), 150);
});

// Обработчик для захвата области
async function saveOrUploadScreenshot(
  event: Electron.IpcMainEvent,
  screenshotBuffer: Buffer,
  fileName: string,
  saveLocally: boolean,
  settings: any
): Promise<void> {
  if (saveLocally) {
    const saveOptions: Electron.SaveDialogOptions = {
      defaultPath: fileName,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    };
    // На Linux диалог без родителя: скрытое окно 100×100 на Wayland часто его не показывает.
    // На Windows родитель — скрытое окно, не окно захвата (иначе при закрытии окна захвата приложение может завершиться).
    const parentWin = process.platform === 'linux'
      ? null
      : (getMainWindow() ?? BrowserWindow.fromWebContents(event.sender));
    if (process.platform !== 'linux' && (!parentWin || parentWin.isDestroyed())) {
      replyUploadComplete(event, { success: false, error: 'Окно недоступно', saveLocally: true }, settings);
      return;
    }
    // Окна захвата поверх всех (alwaysOnTop) — диалог уходит под них. Временно убираем поверх всех и игнорируем мышь.
    overlayWindows.forEach(win => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.setIgnoreMouseEvents(true, { forward: false });
      }
    });
    let canceled = true;
    let savePath: string | undefined;
    try {
      const result = process.platform === 'linux'
        ? await dialog.showSaveDialog(saveOptions)
        : await dialog.showSaveDialog(parentWin!, saveOptions);
      canceled = result.canceled;
      savePath = result.filePath;
    } finally {
      overlayWindows.forEach(win => {
        if (!win.isDestroyed()) {
          win.setAlwaysOnTop(true);
          win.setIgnoreMouseEvents(false);
        }
      });
    }
    if (canceled || !savePath) {
      replyUploadComplete(event, { success: false, error: 'Отменено', saveLocally: true }, settings);
      return;
    }
    fs.writeFileSync(savePath, screenshotBuffer);
    clipboard.writeText(savePath);
    addToHistory({ method: 'Локально', urlOrPath: savePath });
    replyUploadComplete(event, { success: true, path: savePath, url: savePath, saveLocally: true }, settings);
    // Окна закроет renderer по получении upload-complete (send('close-all-windows'))
    return;
  }
  let result: string;
  switch (settings.saveMethod) {
    case 's3':
      result = await new S3Uploader().uploadFile(screenshotBuffer, fileName, settings);
      break;
    case 'ftp':
      result = await new FTPUploader().uploadFile(screenshotBuffer, fileName, settings);
      break;
    case 'ssh':
      result = await new SSHUploader().uploadFile(screenshotBuffer, fileName, settings);
      break;
    case 'api':
      result = await new ApiUploader().uploadFile(screenshotBuffer, fileName, settings);
      break;
    default:
      throw new Error(`Unknown save method: ${settings.saveMethod}`);
  }
  const baseUrl = (settings.baseUrl || '').trim().replace(/\/$/, '') || 'https://vault.by';
  let fullUrl: string;
  if (settings.saveMethod === 'api' && /^https?:\/\//i.test(result)) {
    // API returns the public file URL
    fullUrl = result;
  } else if (settings.saveMethod === 'ssh' || settings.saveMethod === 'ftp') {
    // Public URL is Base URL + filename (remote destinationPath is only for upload, not the link)
    fullUrl = `${baseUrl}/${fileName}`;
  } else {
    const urlPath = result.startsWith('/') ? result : `/${result}`;
    fullUrl = `${baseUrl}${urlPath}`;
  }
  clipboard.writeText(fullUrl);
  const methodLabel =
    settings.saveMethod === 's3' ? 'S3' :
    settings.saveMethod === 'ftp' ? 'FTP' :
    settings.saveMethod === 'api' ? 'API' : 'SSH';
  addToHistory({ method: methodLabel, urlOrPath: fullUrl });
  replyUploadComplete(event, { success: true, path: result, url: fullUrl, saveLocally: false }, settings);
  // Окна закроет renderer по получении upload-complete (send('close-all-windows'))
}

ipcMain.on('capture-area', async (event, areaData) => {
  if (!areaData?.saveLocally) {
    const runtime = getRuntimeUploadSettings();
    if ('error' in runtime && runtime.error === 'locked') {
      ensureVaultUnlockedForUpload();
      const appS = loadAppSettings();
      const lang = resolveLanguage(appS.language || 'system', app.getLocale());
      const tr = getTranslations(lang);
      replyUploadComplete(event, {
        success: false,
        error: tr.vault_errLocked || 'Unlock the vault first',
        saveLocally: false
      });
      return;
    }
  }

  const settings = (() => {
    if (areaData?.saveLocally) {
      return loadSettings();
    }
    const runtime = getRuntimeUploadSettings();
    if ('error' in runtime) {
      return loadSettings();
    }
    return runtime;
  })();
  
  try {
    let sourceDisplayId: number | undefined;
    if (activeWindow) {
      sourceDisplayId = (activeWindow as any).displayId;
      console.log(`Using active window display ID: ${sourceDisplayId}`);
    } else if (overlayWindows.length > 0) {
      sourceDisplayId = (overlayWindows[0] as any).displayId;
      console.log(`Using single window display ID: ${sourceDisplayId}`);
    } else {
      sourceDisplayId = screen.getPrimaryDisplay().id;
      console.log(`Using primary display ID: ${sourceDisplayId}`);
    }

    const screenshotBuffer = await captureScreenshot(areaData, sourceDisplayId);
    const fileName = `screenshot-${Date.now()}.png`;

    const watermarkEnabled = settings.watermark?.enabled && (settings.watermark?.text || '').trim() !== '';
    const hasAnnotations = areaData.annotations && Array.isArray(areaData.annotations) && areaData.annotations.length > 0;

    if (watermarkEnabled || hasAnnotations) {
      pendingWatermark.set(event.sender.id, { saveLocally: !!areaData.saveLocally, fileName, settings });
      // Pass raw PNG bytes — avoid NativeImage → dataURL round-trip (color/profile loss)
      if (hasAnnotations) {
        event.reply('compose-image', {
          pngBuffer: screenshotBuffer,
          annotations: areaData.annotations,
          watermark: watermarkEnabled ? settings.watermark : null
        });
      } else {
        event.reply('apply-watermark', { pngBuffer: screenshotBuffer, watermark: settings.watermark });
      }
      return;
    }

    await saveOrUploadScreenshot(event, screenshotBuffer, fileName, !!areaData.saveLocally, settings);
  } catch (error) {
    console.error('Upload failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: !!(areaData && areaData.saveLocally)
    }, settings);
  }
});

function asPngBuffer(payload: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
}

ipcMain.on('watermark-done', async (event, pngPayload: Buffer | Uint8Array | ArrayBuffer) => {
  const pending = pendingWatermark.get(event.sender.id);
  pendingWatermark.delete(event.sender.id);
  if (!pending) return;
  try {
    const buffer = asPngBuffer(pngPayload);
    await saveOrUploadScreenshot(event, buffer, pending.fileName, pending.saveLocally, pending.settings);
  } catch (error) {
    console.error('Watermark save failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: pending.saveLocally
    }, pending.settings);
  }
});

ipcMain.on('watermark-error', (event, errorMessage: string) => {
  const pending = pendingWatermark.get(event.sender.id);
  pendingWatermark.delete(event.sender.id);
  if (pending) {
    replyUploadComplete(event, {
      success: false,
      error: errorMessage || 'Ошибка наложения водяного знака',
      saveLocally: pending.saveLocally
    }, pending.settings);
  } else {
    hideAllCaptureWindows();
  }
});

ipcMain.on('compose-image-done', async (event, pngPayload: Buffer | Uint8Array | ArrayBuffer) => {
  const pending = pendingWatermark.get(event.sender.id);
  pendingWatermark.delete(event.sender.id);
  if (!pending) return;
  try {
    const buffer = asPngBuffer(pngPayload);
    await saveOrUploadScreenshot(event, buffer, pending.fileName, pending.saveLocally, pending.settings);
  } catch (error) {
    console.error('Compose image save failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: pending.saveLocally
    }, pending.settings);
  }
});

ipcMain.on('compose-image-error', (event, errorMessage: string) => {
  const pending = pendingWatermark.get(event.sender.id);
  pendingWatermark.delete(event.sender.id);
  if (pending) {
    replyUploadComplete(event, {
      success: false,
      error: errorMessage || 'Ошибка композиции изображения',
      saveLocally: pending.saveLocally
    }, pending.settings);
  } else {
    hideAllCaptureWindows();
  }
});