import { BrowserWindow, desktopCapturer, nativeImage, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  getCaptureSettings,
  saveCaptureSettings,
  CaptureMode
} from './settings-store';
import { secureWebPreferences } from './window-defaults';
import {
  closeAllCaptureWindows,
  closeCaptureWindow,
  closeCountdownWindow,
  closeWindowPicker,
  closeFixedAnnotateWindow,
  getOverlayWindows,
  setOverlayWindows,
  pushOverlayWindow,
  filterOverlayWindows,
  getActiveWindow,
  setActiveWindow,
  getCountdownWindow,
  setCountdownWindow,
  getWindowPickerWindow,
  setWindowPickerWindow,
  getFixedAnnotateWindow,
  setFixedAnnotateWindow,
  getCountdownResolve,
  setCountdownResolve,
  getPendingFixedCapture,
  setLastFixedMode,
  setPendingHistorySource,
  hideOverlaysForCapture,
  isCaptureSessionOpen
} from './capture-session';
import { captureScreenshot, captureWindowSource } from './capture-platform';
import { getLangTranslations, showCaptureErrorNotification } from './save-or-upload';

export interface SetupScreenCaptureOptions {
  mode?: CaptureMode;
  /** When set and > 0, show countdown before starting the mode */
  delaySeconds?: number;
}

export function finishCountdown(ok: boolean): void {
  const r = getCountdownResolve();
  setCountdownResolve(null);
  closeCountdownWindow();
  if (r) r(ok);
}

export function runCountdown(seconds: number): Promise<boolean> {
  closeCountdownWindow();
  const { t } = getLangTranslations();
  const hint = t.capture_countdownHint || 'Click or press ESC to cancel';
  const primary = screen.getPrimaryDisplay();
  const w = 220;
  const h = 160;
  const x = Math.round(primary.workArea.x + (primary.workArea.width - w) / 2);
  const y = Math.round(primary.workArea.y + (primary.workArea.height - h) / 2);

  return new Promise((resolve) => {
    setCountdownResolve(resolve);
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
      webPreferences: secureWebPreferences()
    });
    setCountdownWindow(win);
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
const api=window.simpleShot;
let left=${Math.max(1, Math.floor(seconds))};
const el=document.getElementById('n');
document.body.addEventListener('click',()=>api.send('countdown-cancel'));
window.addEventListener('keydown',e=>{if(e.key==='Escape')api.send('countdown-cancel');});
const t=setInterval(()=>{
  left--;
  if(left<=0){clearInterval(t);api.send('countdown-done');return;}
  el.textContent=String(left);
},1000);
</script></body></html>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.setAlwaysOnTop(true, 'screen-saver');
    win.on('closed', () => {
      if (getCountdownWindow() === win) setCountdownWindow(null);
      const countdownResolve = getCountdownResolve();
      if (countdownResolve) {
        setCountdownResolve(null);
        countdownResolve(false);
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

export function createOverlayWindow(
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
    webPreferences: secureWebPreferences()
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
  pushOverlayWindow(overlayWindow);

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
    filterOverlayWindows((win) => !win.isDestroyed());
    if (getActiveWindow() === overlayWindow) setActiveWindow(null);
  });

  overlayWindow.on('focus', () => {
    if (!overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(true);
      if (typeof overlayWindow.moveTop === 'function') overlayWindow.moveTop();
    }
  });

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeAllCaptureWindows();
    }
  });

  return overlayWindow;
}

function startRegionCapture(): void {
  closeAllCaptureWindows();
  closeWindowPicker();
  closeFixedAnnotateWindow();
  setActiveWindow(null);

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
  setActiveWindow(null);

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

export function openFixedAnnotation(buffer: Buffer, mode: CaptureMode = 'fullscreen'): void {
  setLastFixedMode(mode === 'window' ? 'window' : 'fullscreen');
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
    webPreferences: secureWebPreferences()
  });
  setFixedAnnotateWindow(win);
  setOverlayWindows([win]);
  setActiveWindow(win);
  const webContentsId = win.webContents.id;
  const pendingFixedCapture = getPendingFixedCapture();

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
    if (getFixedAnnotateWindow() === win) setFixedAnnotateWindow(null);
    filterOverlayWindows((w) => !w.isDestroyed());
    if (getActiveWindow() === win) setActiveWindow(null);
    setPendingHistorySource('capture');
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeFixedAnnotateWindow();
      setOverlayWindows([]);
      setActiveWindow(null);
      setPendingHistorySource('capture');
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
    setPendingHistorySource('reedit');
    openFixedAnnotation(buffer, 'fullscreen');
    return { ok: true };
  } catch (e) {
    console.error('openHistoryReedit failed', e);
    setPendingHistorySource('capture');
    return { ok: false, error: 'unavailable' };
  }
}

export async function runFullscreenCapture(displayId?: number): Promise<void> {
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

export async function openWindowPicker(): Promise<void> {
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
    webPreferences: secureWebPreferences()
  });
  setWindowPickerWindow(win);

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
    if (getWindowPickerWindow() === win) setWindowPickerWindow(null);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      closeWindowPicker();
    }
  });
}

export async function runWindowCapture(sourceId: string): Promise<void> {
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

export function startCaptureMode(mode: CaptureMode): void {
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
  const delay = typeof options?.delaySeconds === 'number' ? options.delaySeconds : undefined;

  if (typeof delay === 'number' && delay > 0) {
    if (isCaptureSessionOpen()) return;
    void runCountdown(delay).then((ok) => {
      if (ok) startCaptureMode(mode);
    });
    return;
  }

  startCaptureMode(mode);
}

/** IPC: activate one overlay and close the rest */
export function handleActivateSingleWindow(screenId: string | number): void {
  const overlayWindows = getOverlayWindows();
  console.log(`Активируем окно ${screenId}, закрываем остальные`);

  const active =
    overlayWindows.find((win) => {
      const winUrl = win.webContents.getURL();
      return winUrl.includes(`screenId=${screenId}`);
    }) || null;
  setActiveWindow(active);

  if (active) {
    console.log(`Active window display ID: ${(active as any).displayId}`);
  }

  overlayWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      const winScreenId = win.webContents.getURL().includes(`screenId=${screenId}`);
      if (!winScreenId) {
        closeCaptureWindow(win);
      }
    }
  });

  filterOverlayWindows((win) => !win.isDestroyed());
}
