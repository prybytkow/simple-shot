import { app, BrowserWindow, screen, ipcMain, desktopCapturer, clipboard, ClipboardItem, dialog, Notification, shell, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { recordCaptureToHistory, HistoryMethod, HistoryFormat, HistorySource } from './history';
import { S3Uploader } from './uploaders/s3-uploader';
import { FTPUploader } from './uploaders/ftp-uploader';
import { SSHUploader } from './uploaders/ssh-uploader';
import { ApiUploader } from './uploaders/api-uploader';

import { loadSettings, getMainWindow, ensureVaultUnlockedForUpload } from './main';
import {
  getRuntimeUploadSettings,
  loadAppSettings,
  getCaptureSettings,
  saveCaptureSettings,
  getExportSettings,
  getActiveProfile,
  CaptureMode,
  ExportDestination
} from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';
import { createNotifyIcon } from './app-icon';
import { encodeImage, renderFileName } from './export-encode';

type AfterUploadFeedback = 'overlay' | 'notification' | 'window';
type CaptureDestination = ExportDestination;

export type { CaptureMode };

export interface SetupScreenCaptureOptions {
  mode?: CaptureMode;
  /** When set and > 0, show countdown before starting the mode */
  delaySeconds?: number;
}

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
  const icon = createNotifyIcon();
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
    destination?: CaptureDestination;
    copiedImage?: boolean;
  },
  settings?: { afterUploadFeedback?: string }
): void {
  const feedback = getAfterUploadFeedback(settings);
  event.reply('upload-complete', { ...payload, feedback });
  if (
    payload.success &&
    !payload.saveLocally &&
    !payload.copiedImage &&
    payload.url &&
    feedback === 'notification'
  ) {
    showUploadNotification(payload.url);
  }
  if (payload.success && payload.copiedImage && feedback === 'notification') {
    const { t } = getLangTranslations();
    showCaptureErrorNotification(
      t.notify_copiedTitle || 'Copied',
      t.notify_copiedBody || 'Screenshot copied to clipboard'
    );
  }
}

function resolveDestination(areaData: any): CaptureDestination {
  const d = areaData?.destination;
  if (d === 'file' || d === 'upload' || d === 'clipboard') return d;
  if (areaData?.saveLocally === true) return 'file';
  if (areaData?.saveLocally === false) return 'upload';
  return getExportSettings().defaultDestination;
}

ipcMain.on('copy-text', (_event, text: string) => {
  if (typeof text === 'string' && text) clipboard.writeText(text);
});

let overlayWindows: BrowserWindow[] = [];
let activeWindow: BrowserWindow | null = null;
let countdownWindow: BrowserWindow | null = null;
let windowPickerWindow: BrowserWindow | null = null;
let fixedAnnotateWindow: BrowserWindow | null = null;
let countdownResolve: ((ok: boolean) => void) | null = null;
const pendingWatermark: Map<
  number,
  {
    destination: CaptureDestination;
    mode: CaptureMode;
    settings: any;
    /** Lossless PNG before format encode (for clipboard bitmap). */
    pngBuffer?: Buffer;
  }
> = new Map();
const pendingFixedCapture: Map<number, Buffer> = new Map();
/** Mode for fixed annotation export (fullscreen / window). */
let lastFixedMode: CaptureMode = 'fullscreen';
/** Next successful export was opened from history re-edit. */
let pendingHistorySource: HistorySource = 'capture';

function getLangTranslations() {
  const settings = loadAppSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  return { lang, t: getTranslations(lang) };
}

function showCaptureErrorNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const icon = createNotifyIcon();
  const n = new Notification({
    title,
    body,
    icon: icon && !icon.isEmpty() ? icon : undefined,
    silent: false
  });
  n.show();
}

/** True while a capture overlay is visible (hidden-after-ESC does not count). */
export function isCaptureOverlayOpen(): boolean {
  return overlayWindows.some((w) => !w.isDestroyed() && w.isVisible());
}

/** True while any capture UI is active (overlay, countdown, picker, fixed annotate). */
export function isCaptureSessionOpen(): boolean {
  if (isCaptureOverlayOpen()) return true;
  if (countdownWindow && !countdownWindow.isDestroyed() && countdownWindow.isVisible()) return true;
  if (windowPickerWindow && !windowPickerWindow.isDestroyed()) return true;
  if (fixedAnnotateWindow && !fixedAnnotateWindow.isDestroyed()) return true;
  return false;
}

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
  await hideAuxWindowsForCapture();
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

function closeCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    closeCaptureWindow(countdownWindow);
  }
  countdownWindow = null;
}

function closeWindowPicker(): void {
  if (windowPickerWindow && !windowPickerWindow.isDestroyed()) {
    closeCaptureWindow(windowPickerWindow);
  }
  windowPickerWindow = null;
}

function closeFixedAnnotateWindow(): void {
  if (fixedAnnotateWindow && !fixedAnnotateWindow.isDestroyed()) {
    const id = fixedAnnotateWindow.webContents.id;
    pendingFixedCapture.delete(id);
    closeCaptureWindow(fixedAnnotateWindow);
  }
  fixedAnnotateWindow = null;
}

/** Hide countdown/picker/fixed windows before framebuffer capture. */
async function hideAuxWindowsForCapture(): Promise<void> {
  const wins = [countdownWindow, windowPickerWindow, fixedAnnotateWindow];
  for (const win of wins) {
    if (win && !win.isDestroyed()) {
      win.setOpacity(0);
      win.hide();
    }
  }
  await sleep(80);
}

function runCountdown(seconds: number): Promise<boolean> {
  closeCountdownWindow();
  const { t } = getLangTranslations();
  const hint = t.capture_countdownHint || 'Click or press ESC to cancel';
  const primary = screen.getPrimaryDisplay();
  const w = 220;
  const h = 160;
  const x = Math.round(primary.workArea.x + (primary.workArea.width - w) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - h) / 2);

  return new Promise((resolve) => {
    countdownResolve = resolve;
    const win = new BrowserWindow({
      width: w,
      height: h,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    countdownWindow = win;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;
font-family:Segoe UI,system-ui,sans-serif;background:rgba(20,20,24,.88);color:#fff;border-radius:16px;
user-select:none;cursor:pointer;-webkit-app-region:no-drag}
#n{font-size:64px;font-weight:700;line-height:1}
#h{font-size:12px;opacity:.75;margin-top:10px;text-align:center;padding:0 12px}
</style></head><body>
<div id="n">${Math.max(1, Math.floor(seconds))}</div>
<div id="h">${hint.replace(/</g, '&lt;')}</div>
<script>
const {ipcRenderer}=require('electron');
let left=${Math.max(1, Math.floor(seconds))};
const el=document.getElementById('n');
document.body.addEventListener('click',()=>ipcRenderer.send('countdown-cancel'));
window.addEventListener('keydown',e=>{if(e.key==='Escape')ipcRenderer.send('countdown-cancel');});
const t=setInterval(()=>{
  left--;
  if(left<=0){clearInterval(t);ipcRenderer.send('countdown-done');return;}
  el.textContent=String(left);
},1000);
</script></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('closed', () => {
      if (countdownWindow === win) countdownWindow = null;
      if (countdownResolve) {
        const r = countdownResolve;
        countdownResolve = null;
        r(false);
      }
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') {
        event.preventDefault();
        finishCountdown(false);
      }
    });
  });
}

function finishCountdown(ok: boolean): void {
  const r = countdownResolve;
  countdownResolve = null;
  closeCountdownWindow();
  if (r) r(ok);
}

ipcMain.on('countdown-cancel', () => finishCountdown(false));
ipcMain.on('countdown-done', () => finishCountdown(true));

function createOverlayWindow(
  display: Electron.Display,
  index: number,
  total: number,
  lang: string,
  mode: string
): BrowserWindow {
  const scaleFactor = display.scaleFactor;
  const width = display.bounds.width;
  const height = display.bounds.height;

  const overlayWindow = new BrowserWindow({
    width,
    height,
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

  (overlayWindow as any).displayId = display.id;

  const htmlPath = path.join(__dirname, '../renderer/capture-window.html');
  overlayWindow.loadFile(htmlPath, {
    query: {
      screenId: index.toString(),
      totalScreens: total.toString(),
      scaleFactor: scaleFactor.toString(),
      actualWidth: display.bounds.width.toString(),
      actualHeight: display.bounds.height.toString(),
      displayId: display.id.toString(),
      lang,
      mode
    }
  });

  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindows.push(overlayWindow);

  const displayBounds = { ...display.bounds };
  overlayWindow.webContents.once('did-finish-load', () => {
    if (overlayWindow.isDestroyed()) return;
    overlayWindow.setBounds(displayBounds);
    overlayWindow.setContentBounds(displayBounds);
    overlayWindow.setAlwaysOnTop(true);
    if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
    setTimeout(() => {
      if (!overlayWindow.isDestroyed()) {
        overlayWindow.setBounds(displayBounds);
        overlayWindow.setContentBounds(displayBounds);
        overlayWindow.setAlwaysOnTop(true);
        if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
      }
    }, 200);
  });

  overlayWindow.on('closed', () => {
    overlayWindows = overlayWindows.filter((win) => !win.isDestroyed());
    if (activeWindow === overlayWindow) activeWindow = null;
  });

  overlayWindow.on('focus', () => {
    if (!overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true);
      if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
    }
  });

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      hideAllCaptureWindows();
      event.preventDefault();
    }
  });

  return overlayWindow;
}

function startRegionCapture(): void {
  closeAllCaptureWindows();
  closeWindowPicker();
  closeFixedAnnotateWindow();
  activeWindow = null;

  const displays = screen.getAllDisplays();
  const { lang } = getLangTranslations();
  displays.forEach((display, index) => {
    createOverlayWindow(display, index, displays.length, lang, 'region');
  });
}

function startDisplayPicker(): void {
  closeAllCaptureWindows();
  closeWindowPicker();
  closeFixedAnnotateWindow();
  activeWindow = null;

  const displays = screen.getAllDisplays();
  const { lang } = getLangTranslations();
  displays.forEach((display, index) => {
    createOverlayWindow(display, index, displays.length, lang, 'display-picker');
  });
}

async function captureFullDisplay(displayId: number): Promise<Buffer> {
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  await hideOverlaysForCapture();
  return captureScreenshot(
    { x: 0, y: 0, width: target.bounds.width, height: target.bounds.height },
    target.id
  );
}

async function captureWindowSource(sourceId: string): Promise<Buffer> {
  await hideOverlaysForCapture();
  // Request a large thumbnail; Electron returns the best available window bitmap
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 3840, height: 2160 },
    fetchWindowIcons: false
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error('window_unavailable');
  }
  const size = source.thumbnail.getSize();
  if (size.width < 2 || size.height < 2) {
    throw new Error('window_unavailable');
  }
  return source.thumbnail.toPNG();
}

export function openFixedAnnotation(buffer: Buffer, mode: CaptureMode = 'fullscreen'): void {
  lastFixedMode = mode === 'window' ? 'window' : 'fullscreen';
  closeAllCaptureWindows();
  closeWindowPicker();
  closeFixedAnnotateWindow();

  const img = nativeImage.createFromBuffer(buffer);
  const size = img.getSize();
  const { lang } = getLangTranslations();
  const primary = screen.getPrimaryDisplay();
  const maxW = Math.max(400, primary.workArea.width - 80);
  const maxH = Math.max(300, primary.workArea.height - 80);
  let winW = size.width || 800;
  let winH = size.height || 600;
  const scale = Math.min(1, maxW / winW, maxH / winH);
  winW = Math.round(winW * scale);
  winH = Math.round(winH * scale);
  // Extra room for toolbar below / chrome
  const chromeH = 80;
  winH = Math.min(maxH, winH + chromeH);

  const x = Math.round(primary.workArea.x + (primary.workArea.width - winW) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - winH) / 2);

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  fixedAnnotateWindow = win;
  overlayWindows = [win];
  activeWindow = win;
  // Capture before close — win.webContents is destroyed by the time 'closed' fires
  const webContentsId = win.webContents.id;

  win.loadFile(path.join(__dirname, '../renderer/capture-window.html'), {
    query: {
      mode: 'fixed',
      lang,
      imageWidth: String(size.width || winW),
      imageHeight: String(size.height || winH - chromeH)
    }
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    pendingFixedCapture.set(webContentsId, buffer);
    win.webContents.send('load-fixed-image', buffer);
  });

  win.on('closed', () => {
    pendingFixedCapture.delete(webContentsId);
    if (fixedAnnotateWindow === win) fixedAnnotateWindow = null;
    overlayWindows = overlayWindows.filter((w) => !w.isDestroyed());
    if (activeWindow === win) activeWindow = null;
    pendingHistorySource = 'capture';
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeFixedAnnotateWindow();
      overlayWindows = [];
      activeWindow = null;
      pendingHistorySource = 'capture';
    }
  });
}

/** Open fixed annotation UI from a history media / local file path. */
export function openHistoryReedit(filePath: string): { ok: boolean; error?: string } {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'unavailable' };
    }
    const buffer = fs.readFileSync(filePath);
    if (!buffer.length) return { ok: false, error: 'unavailable' };
    pendingHistorySource = 'reedit';
    openFixedAnnotation(buffer, 'fullscreen');
    return { ok: true };
  } catch (e) {
    console.error('openHistoryReedit failed', e);
    pendingHistorySource = 'capture';
    return { ok: false, error: 'unavailable' };
  }
}

function historyMethodForUpload(saveMethod: string): HistoryMethod {
  if (saveMethod === 's3') return 's3';
  if (saveMethod === 'ftp') return 'ftp';
  if (saveMethod === 'api') return 'api';
  return 'ssh';
}

function historyFormatFromName(fileName: string): HistoryFormat {
  const ext = (fileName.split('.').pop() || 'png').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'webp') return 'webp';
  return 'png';
}

async function recordExportHistory(opts: {
  pngLossless: Buffer;
  method: HistoryMethod;
  urlOrPath: string;
  fileName: string;
  format: HistoryFormat;
  settings: any;
  localImagePath?: string;
  storeFull?: boolean;
}): Promise<void> {
  const source = pendingHistorySource;
  pendingHistorySource = 'capture';
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

async function runFullscreenCapture(displayId?: number): Promise<void> {
  try {
    const displays = screen.getAllDisplays();
    let id = displayId;
    if (id == null) {
      const last = getCaptureSettings().lastDisplayId;
      if (last != null && displays.some((d) => d.id === last)) id = last;
      else id = screen.getPrimaryDisplay().id;
    }
    saveCaptureSettings({ lastDisplayId: id });
    closeAllCaptureWindows();
    const buffer = await captureFullDisplay(id);
    openFixedAnnotation(buffer, 'fullscreen');
  } catch (err) {
    console.error('Fullscreen capture failed:', err);
    const { t } = getLangTranslations();
    showCaptureErrorNotification(
      t.capture_windowUnavailable || 'Capture failed',
      err instanceof Error ? err.message : String(err)
    );
    closeAllCaptureWindows();
  }
}

function startFullscreenCapture(): void {
  const displays = screen.getAllDisplays();
  if (displays.length > 1) {
    startDisplayPicker();
    return;
  }
  void runFullscreenCapture(displays[0]?.id);
}

async function openWindowPicker(): Promise<void> {
  closeAllCaptureWindows();
  closeWindowPicker();
  closeFixedAnnotateWindow();

  const { lang, t } = getLangTranslations();
  let sources: Electron.DesktopCapturerSource[] = [];
  try {
    sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true
    });
  } catch (err) {
    console.warn('getSources(window) failed:', err);
  }

  sources = sources.filter((s) => s.name && !s.thumbnail.isEmpty());
  if (sources.length === 0) {
    showCaptureErrorNotification(
      t.capture_windowUnavailable || 'Window capture unavailable',
      t.capture_windowUnavailableBody || 'Could not capture windows. Try region or full screen.'
    );
    return;
  }

  const primary = screen.getPrimaryDisplay();
  const winW = Math.min(720, primary.workArea.width - 40);
  const winH = Math.min(560, primary.workArea.height - 40);
  const x = Math.round(primary.workArea.x + (primary.workArea.width - winW) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - winH) / 2);

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: true,
    title: t.capture_pickWindow || 'Select a window',
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  windowPickerWindow = win;

  win.loadFile(path.join(__dirname, '../renderer/window-picker.html'), {
    query: { lang }
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    const payload = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL()
    }));
    win.webContents.send('window-sources', payload);
  });

  win.on('closed', () => {
    if (windowPickerWindow === win) windowPickerWindow = null;
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeWindowPicker();
    }
  });
}

async function runWindowCapture(sourceId: string): Promise<void> {
  try {
    saveCaptureSettings({ lastWindowId: sourceId });
    closeWindowPicker();
    const buffer = await captureWindowSource(sourceId);
    openFixedAnnotation(buffer, 'window');
  } catch (err) {
    console.error('Window capture failed:', err);
    const { t } = getLangTranslations();
    showCaptureErrorNotification(
      t.capture_windowUnavailable || 'Window capture unavailable',
      t.capture_windowUnavailableBody || 'Could not capture windows. Try region or full screen.'
    );
  }
}

function startCaptureMode(mode: CaptureMode): void {
  if (mode === 'fullscreen') {
    startFullscreenCapture();
    return;
  }
  if (mode === 'window') {
    void openWindowPicker();
    return;
  }
  startRegionCapture();
}

export function setupScreenCapture(options?: SetupScreenCaptureOptions): void {
  const capture = getCaptureSettings();
  const mode: CaptureMode = options?.mode ?? capture.defaultMode;
  const delay =
    typeof options?.delaySeconds === 'number' ? options.delaySeconds : undefined;

  if (typeof delay === 'number' && delay > 0) {
    if (isCaptureSessionOpen()) return;
    void runCountdown(delay).then((ok) => {
      if (ok) startCaptureMode(mode);
    });
    return;
  }

  startCaptureMode(mode);
}

ipcMain.on('pick-display', (_event, displayIdRaw: unknown) => {
  const displayId = typeof displayIdRaw === 'number' ? displayIdRaw : Number(displayIdRaw);
  if (!Number.isFinite(displayId)) return;
  closeAllCaptureWindows();
  void runFullscreenCapture(displayId);
});

ipcMain.on('window-picked', (_event, sourceId: unknown) => {
  if (typeof sourceId !== 'string' || !sourceId) return;
  void runWindowCapture(sourceId);
});

ipcMain.on('window-picker-cancel', () => {
  closeWindowPicker();
});

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
  closeCountdownWindow();
  closeWindowPicker();
  closeFixedAnnotateWindow();
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

async function prepareExport(
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

// Обработчик для захвата области
async function saveOrUploadScreenshot(
  event: Electron.IpcMainEvent,
  pngBuffer: Buffer,
  destination: CaptureDestination,
  mode: CaptureMode,
  settings: any
): Promise<void> {
  const { fileName, buffer, mimeType, pngLossless } = await prepareExport(pngBuffer, mode);

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
      ext === 'jpg' || ext === 'jpeg'
        ? 'JPEG'
        : ext === 'webp'
          ? 'WebP'
          : 'PNG';
    const saveOptions: Electron.SaveDialogOptions = {
      defaultPath: fileName,
      filters: [
        { name: formatName, extensions: [ext === 'jpeg' ? 'jpg' : ext] },
        { name: t.saveDialog_allImages || 'All images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    };
    const parentWin = process.platform === 'linux'
      ? null
      : (getMainWindow() ?? BrowserWindow.fromWebContents(event.sender));
    if (process.platform !== 'linux' && (!parentWin || parentWin.isDestroyed())) {
      replyUploadComplete(event, { success: false, error: 'Окно недоступно', saveLocally: true, destination: 'file' }, settings);
      return;
    }
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
      replyUploadComplete(event, { success: false, error: 'Отменено', saveLocally: true, destination: 'file' }, settings);
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
    replyUploadComplete(event, { success: true, path: savePath, url: savePath, saveLocally: true, destination: 'file' }, settings);
    return;
  }

  // upload
  let result: string;
  switch (settings.saveMethod) {
    case 's3':
      result = await new S3Uploader().uploadFile(buffer, fileName, settings, mimeType);
      break;
    case 'ftp':
      result = await new FTPUploader().uploadFile(buffer, fileName, settings);
      break;
    case 'ssh':
      result = await new SSHUploader().uploadFile(buffer, fileName, settings);
      break;
    case 'api':
      result = await new ApiUploader().uploadFile(buffer, fileName, settings, mimeType);
      break;
    default:
      throw new Error(`Unknown save method: ${settings.saveMethod}`);
  }
  const baseUrl = (settings.baseUrl || '').trim().replace(/\/$/, '') || 'https://vault.by';
  let fullUrl: string;
  if (settings.saveMethod === 'api' && /^https?:\/\//i.test(result)) {
    fullUrl = result;
  } else if (settings.saveMethod === 'ssh' || settings.saveMethod === 'ftp') {
    fullUrl = `${baseUrl}/${fileName}`;
  } else {
    const urlPath = result.startsWith('/') ? result : `/${result}`;
    fullUrl = `${baseUrl}${urlPath}`;
  }
  clipboard.writeText(fullUrl);
  await recordExportHistory({
    pngLossless,
    method: historyMethodForUpload(settings.saveMethod),
    urlOrPath: fullUrl,
    fileName,
    format: historyFormatFromName(fileName),
    settings,
    storeFull: true
  });
  replyUploadComplete(event, { success: true, path: result, url: fullUrl, saveLocally: false, destination: 'upload' }, settings);
}

ipcMain.on('capture-area', async (event, areaData) => {
  const destination = resolveDestination(areaData);
  const mode: CaptureMode = 'region';

  if (destination === 'upload') {
    const runtime = getRuntimeUploadSettings();
    if ('error' in runtime && runtime.error === 'locked') {
      ensureVaultUnlockedForUpload();
      const appS = loadAppSettings();
      const lang = resolveLanguage(appS.language || 'system', app.getLocale());
      const tr = getTranslations(lang);
      replyUploadComplete(event, {
        success: false,
        error: tr.vault_errLocked || 'Unlock the vault first',
        saveLocally: false,
        destination
      });
      return;
    }
  }

  const settings = (() => {
    if (destination !== 'upload') {
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

    const watermarkEnabled = settings.watermark?.enabled && (settings.watermark?.text || '').trim() !== '';
    const hasAnnotations = areaData.annotations && Array.isArray(areaData.annotations) && areaData.annotations.length > 0;

    if (watermarkEnabled || hasAnnotations) {
      pendingWatermark.set(event.sender.id, { destination, mode, settings });
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

    await saveOrUploadScreenshot(event, screenshotBuffer, destination, mode, settings);
  } catch (error) {
    console.error('Upload failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: destination === 'file',
      destination
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
    await saveOrUploadScreenshot(event, buffer, pending.destination, pending.mode, pending.settings);
  } catch (error) {
    console.error('Watermark save failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: pending.destination === 'file',
      destination: pending.destination
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
      saveLocally: pending.destination === 'file',
      destination: pending.destination
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
    await saveOrUploadScreenshot(event, buffer, pending.destination, pending.mode, pending.settings);
  } catch (error) {
    console.error('Compose image save failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: pending.destination === 'file',
      destination: pending.destination
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
      saveLocally: pending.destination === 'file',
      destination: pending.destination
    }, pending.settings);
  } else {
    hideAllCaptureWindows();
  }
});

/** Export from fixed annotation UI (fullscreen/window) — buffer already captured. */
ipcMain.on('fixed-capture-area', async (event, areaData) => {
  const destination = resolveDestination(areaData);
  const mode: CaptureMode = lastFixedMode === 'window' ? 'window' : 'fullscreen';
  const screenshotBuffer = pendingFixedCapture.get(event.sender.id);
  if (!screenshotBuffer) {
    replyUploadComplete(event, {
      success: false,
      error: 'No captured image',
      saveLocally: destination === 'file',
      destination
    });
    return;
  }

  if (destination === 'upload') {
    const runtime = getRuntimeUploadSettings();
    if ('error' in runtime && runtime.error === 'locked') {
      ensureVaultUnlockedForUpload();
      const appS = loadAppSettings();
      const lang = resolveLanguage(appS.language || 'system', app.getLocale());
      const tr = getTranslations(lang);
      replyUploadComplete(event, {
        success: false,
        error: tr.vault_errLocked || 'Unlock the vault first',
        saveLocally: false,
        destination
      });
      return;
    }
  }

  const settings = (() => {
    if (destination !== 'upload') {
      return loadSettings();
    }
    const runtime = getRuntimeUploadSettings();
    if ('error' in runtime) {
      return loadSettings();
    }
    return runtime;
  })();

  try {
    const watermarkEnabled = settings.watermark?.enabled && (settings.watermark?.text || '').trim() !== '';
    const hasAnnotations = areaData.annotations && Array.isArray(areaData.annotations) && areaData.annotations.length > 0;

    if (watermarkEnabled || hasAnnotations) {
      pendingWatermark.set(event.sender.id, { destination, mode, settings });
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

    await saveOrUploadScreenshot(event, screenshotBuffer, destination, mode, settings);
  } catch (error) {
    console.error('Fixed capture export failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    replyUploadComplete(event, {
      success: false,
      error: errorMessage,
      saveLocally: destination === 'file',
      destination
    }, settings);
  }
});