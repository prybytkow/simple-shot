import { BrowserWindow } from 'electron';
import { HistorySource } from './history';
import { CaptureMode, ExportDestination } from './settings-store';

export type CaptureDestination = ExportDestination;

export type PendingWatermarkEntry = {
  destination: CaptureDestination;
  mode: CaptureMode;
  settings: any;
  pngBuffer?: Buffer;
};

let overlayWindows: BrowserWindow[] = [];
let activeWindow: BrowserWindow | null = null;
let countdownWindow: BrowserWindow | null = null;
let windowPickerWindow: BrowserWindow | null = null;
let fixedAnnotateWindow: BrowserWindow | null = null;
let countdownResolve: ((ok: boolean) => void) | null = null;
const pendingWatermark = new Map<number, PendingWatermarkEntry>();
const pendingFixedCapture = new Map<number, Buffer>();
let lastFixedMode: CaptureMode = 'fullscreen';
let pendingHistorySource: HistorySource = 'capture';

export function getOverlayWindows(): BrowserWindow[] {
  return overlayWindows;
}

export function setOverlayWindows(windows: BrowserWindow[]): void {
  overlayWindows = windows;
}

export function pushOverlayWindow(win: BrowserWindow): void {
  overlayWindows.push(win);
}

export function filterOverlayWindows(predicate: (win: BrowserWindow) => boolean): void {
  overlayWindows = overlayWindows.filter(predicate);
}

export function getActiveWindow(): BrowserWindow | null {
  return activeWindow;
}

export function setActiveWindow(win: BrowserWindow | null): void {
  activeWindow = win;
}

export function getCountdownWindow(): BrowserWindow | null {
  return countdownWindow;
}

export function setCountdownWindow(win: BrowserWindow | null): void {
  countdownWindow = win;
}

export function getWindowPickerWindow(): BrowserWindow | null {
  return windowPickerWindow;
}

export function setWindowPickerWindow(win: BrowserWindow | null): void {
  windowPickerWindow = win;
}

export function getFixedAnnotateWindow(): BrowserWindow | null {
  return fixedAnnotateWindow;
}

export function setFixedAnnotateWindow(win: BrowserWindow | null): void {
  fixedAnnotateWindow = win;
}

export function getCountdownResolve(): ((ok: boolean) => void) | null {
  return countdownResolve;
}

export function setCountdownResolve(resolve: ((ok: boolean) => void) | null): void {
  countdownResolve = resolve;
}

export function getPendingWatermark(): Map<number, PendingWatermarkEntry> {
  return pendingWatermark;
}

export function getPendingFixedCapture(): Map<number, Buffer> {
  return pendingFixedCapture;
}

export function getLastFixedMode(): CaptureMode {
  return lastFixedMode;
}

export function setLastFixedMode(mode: CaptureMode): void {
  lastFixedMode = mode;
}

export function getPendingHistorySource(): HistorySource {
  return pendingHistorySource;
}

export function setPendingHistorySource(source: HistorySource): void {
  pendingHistorySource = source;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True while a capture overlay window still exists. */
export function isCaptureOverlayOpen(): boolean {
  return overlayWindows.some((w) => !w.isDestroyed());
}

/** True while any capture UI is active (overlay, countdown, picker, fixed annotate). */
export function isCaptureSessionOpen(): boolean {
  if (isCaptureOverlayOpen()) return true;
  if (countdownWindow && !countdownWindow.isDestroyed() && countdownWindow.isVisible()) return true;
  if (windowPickerWindow && !windowPickerWindow.isDestroyed()) return true;
  if (fixedAnnotateWindow && !fixedAnnotateWindow.isDestroyed()) return true;
  return false;
}

/**
 * Tear down a capture window. On Linux, hide first then destroy on the next turn —
 * Wayland close()/destroy of a transparent overlay can SIGTRAP.
 */
export function closeCaptureWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (process.platform === 'linux') {
    win.hide();
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, 0);
    return;
  }
  win.destroy();
}

export function closeCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    closeCaptureWindow(countdownWindow);
  }
  countdownWindow = null;
}

export function closeWindowPicker(): void {
  if (windowPickerWindow && !windowPickerWindow.isDestroyed()) {
    closeCaptureWindow(windowPickerWindow);
  }
  windowPickerWindow = null;
}

export function closeFixedAnnotateWindow(): void {
  if (fixedAnnotateWindow && !fixedAnnotateWindow.isDestroyed()) {
    const id = fixedAnnotateWindow.webContents.id;
    pendingFixedCapture.delete(id);
    closeCaptureWindow(fixedAnnotateWindow);
  }
  fixedAnnotateWindow = null;
}

/** Hide countdown/picker/fixed windows before framebuffer capture. */
export async function hideAuxWindowsForCapture(): Promise<void> {
  const wins = [countdownWindow, windowPickerWindow, fixedAnnotateWindow];
  for (const win of wins) {
    if (win && !win.isDestroyed()) {
      win.setOpacity(0);
      win.hide();
    }
  }
  await sleep(80);
}

/** Hide overlays so they are not included in the framebuffer capture. */
export async function hideOverlaysForCapture(): Promise<void> {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(0);
      win.hide();
    }
  }
  await hideAuxWindowsForCapture();
  await sleep(80);
}

/** Show overlays again after a Linux capture so upload feedback still has a window. */
export async function restoreOverlaysAfterCapture(): Promise<void> {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) {
      win.setOpacity(1);
      win.show();
      win.setAlwaysOnTop(true);
    }
  }
}

/** Destroy all capture overlays and aux windows (ESC, finish, new capture). */
export function closeAllCaptureWindows(): void {
  overlayWindows.forEach((win) => closeCaptureWindow(win));
  overlayWindows = [];
  activeWindow = null;
  closeCountdownWindow();
  closeWindowPicker();
  closeFixedAnnotateWindow();
}
