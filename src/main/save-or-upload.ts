import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  shell
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { recordCaptureToHistory, HistoryMethod, HistoryFormat } from './history';
import { uploadBySaveMethod } from './uploaders/dispatch';
import { buildPublicUrl, historyMethodFromSaveMethod } from './upload-url';
import {
  getRuntimeUploadSettings,
  loadAppSettings,
  loadSettingsCompat,
  getExportSettings,
  getActiveProfile,
  CaptureMode
} from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';
import { appIconPath } from './app-icon';
import { secureWebPreferences } from './window-defaults';
import { showAppNotification } from './app-notify';
import { encodeImage, renderFileName } from './export-encode';
import {
  closeAllCaptureWindows,
  CaptureDestination,
  getOverlayWindows,
  getPendingHistorySource,
  setPendingHistorySource
} from './capture-session';

type AfterUploadFeedback = 'overlay' | 'notification' | 'window';
type UploadFeedbackState = 'uploading' | 'success' | 'error';

let uploadFeedbackWindow: BrowserWindow | null = null;
let uploadFeedbackIpcRegistered = false;

export type { CaptureDestination };

/** Always from app settings (not upload profile credentials). */
function getAfterUploadFeedback(_ignored?: { afterUploadFeedback?: string }): AfterUploadFeedback {
  const f = loadAppSettings().afterUploadFeedback;
  if (f === 'notification' || f === 'window') return f;
  return 'overlay';
}

function showUploadNotification(url: string): void {
  const settings = loadAppSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  const t = getTranslations(lang);
  showAppNotification({
    title: t.notify_linkCopiedTitle || 'Link copied',
    body: url,
    openUrl: url
  });
}

export function ensureUploadFeedbackIpc(): void {
  if (uploadFeedbackIpcRegistered) return;
  uploadFeedbackIpcRegistered = true;
  ipcMain.on('upload-feedback-close', () => {
    closeUploadFeedbackWindow();
  });
  ipcMain.on('upload-feedback-open', (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  });
}

function closeUploadFeedbackWindow(): void {
  if (!uploadFeedbackWindow || uploadFeedbackWindow.isDestroyed()) {
    uploadFeedbackWindow = null;
    return;
  }
  const win = uploadFeedbackWindow;
  uploadFeedbackWindow = null;
  try {
    win.close();
  } catch {
    /* ignore */
  }
}

function sendUploadFeedbackState(payload: {
  state: UploadFeedbackState;
  url?: string;
  error?: string;
  autoCloseMs?: number;
}): void {
  if (!uploadFeedbackWindow || uploadFeedbackWindow.isDestroyed()) return;
  try {
    uploadFeedbackWindow.webContents.send('upload-feedback-state', payload);
  } catch {
    /* ignore */
  }
}

function showUploadFeedbackWindow(initial: UploadFeedbackState = 'uploading'): void {
  ensureUploadFeedbackIpc();
  const { lang } = getLangTranslations();
  if (uploadFeedbackWindow && !uploadFeedbackWindow.isDestroyed()) {
    sendUploadFeedbackState({ state: initial });
    if (!uploadFeedbackWindow.isVisible()) uploadFeedbackWindow.show();
    uploadFeedbackWindow.focus();
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const width = 360;
  const height = 220;
  const x = Math.round(primary.workArea.x + (primary.workArea.width - width) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - height) / 2);
  const iconPath = appIconPath();

  uploadFeedbackWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: true,
    title: 'Upload',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: secureWebPreferences()
  });

  const win = uploadFeedbackWindow;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '../renderer/upload-feedback.html'), {
    query: { lang, state: initial }
  });
  win.on('closed', () => {
    if (uploadFeedbackWindow === win) uploadFeedbackWindow = null;
  });
}

function beginNetworkUploadFeedback(): void {
  showUploadFeedbackWindow('uploading');
  closeAllCaptureWindows();
}

function finishNetworkUploadFeedback(payload: {
  success: boolean;
  url?: string;
  error?: string;
}): void {
  const feedback = getAfterUploadFeedback();
  closeAllCaptureWindows();

  if (!payload.success) {
    if (!uploadFeedbackWindow || uploadFeedbackWindow.isDestroyed()) {
      showUploadFeedbackWindow('error');
    }
    sendUploadFeedbackState({
      state: 'error',
      error: payload.error || 'Upload failed'
    });
    return;
  }

  if (feedback === 'notification') {
    closeUploadFeedbackWindow();
    if (payload.url) showUploadNotification(payload.url);
    return;
  }

  if (!uploadFeedbackWindow || uploadFeedbackWindow.isDestroyed()) {
    showUploadFeedbackWindow('success');
  }
  const autoCloseMs = feedback === 'window' ? 0 : 2500;
  sendUploadFeedbackState({
    state: 'success',
    url: payload.url || '',
    autoCloseMs
  });
}

function isNetworkUploadPayload(payload: {
  saveLocally: boolean;
  destination?: CaptureDestination;
  copiedImage?: boolean;
}): boolean {
  if (payload.copiedImage) return false;
  if (payload.saveLocally || payload.destination === 'file') return false;
  if (payload.destination === 'clipboard') return false;
  return payload.destination === 'upload' || payload.destination == null;
}

export function replyUploadComplete(
  event: Electron.IpcMainEvent,
  payload: {
    success: boolean;
    path?: string;
    url?: string;
    error?: string;
    saveLocally: boolean;
    destination?: CaptureDestination;
    copiedImage?: boolean;
  },
  settings?: { afterUploadFeedback?: string }
): void {
  const feedback = getAfterUploadFeedback(settings);

  if (isNetworkUploadPayload(payload)) {
    finishNetworkUploadFeedback({
      success: payload.success,
      url: payload.url,
      error: payload.error
    });
    return;
  }

  try {
    if (!event.sender.isDestroyed()) {
      event.reply('upload-complete', { ...payload, feedback });
    }
  } catch {
    /* ignore */
  }

  if (payload.success && payload.copiedImage && feedback === 'notification') {
    const { t } = getLangTranslations();
    showCaptureErrorNotification(
      t.notify_copiedTitle || 'Copied',
      t.notify_copiedBody || 'Screenshot copied to clipboard'
    );
  }
}

export function resolveDestination(areaData: any): CaptureDestination {
  const d = areaData?.destination;
  if (d === 'file' || d === 'upload' || d === 'clipboard') return d;
  if (areaData?.saveLocally === true) return 'file';
  if (areaData?.saveLocally === false) return 'upload';
  return getExportSettings().defaultDestination;
}

export function getLangTranslations() {
  const settings = loadAppSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  return { lang, t: getTranslations(lang) };
}

export function showCaptureErrorNotification(title: string, body: string): void {
  showAppNotification({ title, body });
}

export function historyFormatFromName(fileName: string): HistoryFormat {
  const ext = (fileName.split('.').pop() || 'png').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'webp') return 'webp';
  return 'png';
}

export function resolveCaptureSettings(destination: CaptureDestination) {
  if (destination === 'upload') {
    const runtime = getRuntimeUploadSettings();
    if (!('error' in runtime)) return runtime;
  }
  return loadSettingsCompat();
}

export async function recordExportHistory(opts: {
  pngLossless: Buffer;
  method: HistoryMethod;
  urlOrPath: string;
  fileName: string;
  format: HistoryFormat;
  settings: any;
  localImagePath?: string;
  storeFull?: boolean;
}): Promise<void> {
  const source = getPendingHistorySource();
  setPendingHistorySource('capture');
  const profile = getActiveProfile();
  try {
    await recordCaptureToHistory({
      buffer: opts.pngLossless,
      method: opts.method,
      urlOrPath: opts.urlOrPath,
      fileName: opts.fileName,
      format: opts.format,
      profileId: profile?.id,
      profileName: profile?.name,
      source,
      localImagePath: opts.localImagePath,
      storeFull: opts.storeFull
    });
  } catch (e) {
    console.error('recordExportHistory failed', e);
  }
}

export async function prepareExport(
  pngBuffer: Buffer,
  mode: CaptureMode
): Promise<{ fileName: string; buffer: Buffer; mimeType: string; pngLossless: Buffer }> {
  const exportSettings = getExportSettings();
  const img = nativeImage.createFromBuffer(pngBuffer);
  const size = img.getSize();
  const profile = getActiveProfile();
  const quality =
    exportSettings.format === 'jpg'
      ? exportSettings.jpegQuality
      : exportSettings.format === 'webp'
        ? exportSettings.webpQuality
        : 100;
  const encoded = await encodeImage(pngBuffer, exportSettings.format, quality);
  const fileName = renderFileName(exportSettings.fileNameTemplate, {
    width: size.width || 0,
    height: size.height || 0,
    format: exportSettings.format,
    profile: profile?.name || 'Default',
    mode
  });
  return {
    fileName,
    buffer: encoded.buffer,
    mimeType: encoded.mimeType,
    pngLossless: pngBuffer
  };
}

export async function saveOrUploadScreenshot(
  event: Electron.IpcMainEvent,
  pngBuffer: Buffer,
  destination: CaptureDestination,
  mode: CaptureMode,
  settings: any
): Promise<void> {
  const { fileName, buffer, mimeType, pngLossless } = await prepareExport(pngBuffer, mode);
  const overlayWindows = getOverlayWindows();

  if (destination === 'clipboard') {
    const png = nativeImage.createFromBuffer(pngLossless).toPNG();
    await clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' })
      })
    ]);
    await recordExportHistory({
      pngLossless,
      method: 'clipboard',
      urlOrPath: '',
      fileName,
      format: historyFormatFromName(fileName),
      settings,
      storeFull: true
    });
    replyUploadComplete(
      event,
      {
        success: true,
        saveLocally: false,
        destination: 'clipboard',
        copiedImage: true
      },
      settings
    );
    return;
  }

  if (destination === 'file') {
    const { t } = getLangTranslations();
    const ext = fileName.split('.').pop() || 'png';
    const formatName =
      ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : ext === 'webp' ? 'WebP' : 'PNG';
    const saveOptions: Electron.SaveDialogOptions = {
      defaultPath: fileName,
      filters: [
        { name: formatName, extensions: [ext === 'jpeg' ? 'jpg' : ext] },
        { name: t.saveDialog_allImages || 'All images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    };
    const parentWin = BrowserWindow.fromWebContents(event.sender);
    const useParent =
      process.platform !== 'linux' && parentWin != null && !parentWin.isDestroyed();
    overlayWindows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(false);
        win.setIgnoreMouseEvents(true, { forward: false });
      }
    });
    let canceled = true;
    let savePath: string | undefined;
    try {
      const result = useParent
        ? await dialog.showSaveDialog(parentWin!, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      canceled = result.canceled;
      savePath = result.filePath;
    } finally {
      overlayWindows.forEach((win) => {
        if (!win.isDestroyed()) {
          win.setAlwaysOnTop(true);
          win.setIgnoreMouseEvents(false);
        }
      });
    }
    if (canceled || !savePath) {
      const { t: tr } = getLangTranslations();
      replyUploadComplete(
        event,
        {
          success: false,
          error: tr.common_cancelled || 'Cancelled',
          saveLocally: true,
          destination: 'file'
        },
        settings
      );
      return;
    }
    fs.writeFileSync(savePath, buffer);
    clipboard.writeText(savePath);
    await recordExportHistory({
      pngLossless,
      method: 'local',
      urlOrPath: savePath,
      fileName,
      format: historyFormatFromName(fileName),
      settings,
      localImagePath: savePath,
      storeFull: false
    });
    replyUploadComplete(
      event,
      { success: true, path: savePath, url: savePath, saveLocally: true, destination: 'file' },
      settings
    );
    return;
  }

  beginNetworkUploadFeedback();
  let result: string;
  try {
    result = await uploadBySaveMethod(settings.saveMethod, buffer, fileName, settings, mimeType);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    replyUploadComplete(
      event,
      { success: false, error: errorMessage, saveLocally: false, destination: 'upload' },
      settings
    );
    return;
  }
  const fullUrl = buildPublicUrl(result, settings, fileName);
  clipboard.writeText(fullUrl);
  await recordExportHistory({
    pngLossless,
    method: historyMethodFromSaveMethod(settings.saveMethod),
    urlOrPath: fullUrl,
    fileName,
    format: historyFormatFromName(fileName),
    settings,
    storeFull: true
  });
  replyUploadComplete(
    event,
    { success: true, path: result, url: fullUrl, saveLocally: false, destination: 'upload' },
    settings
  );
}

export function asPngBuffer(payload: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
}
