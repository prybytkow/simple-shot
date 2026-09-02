import { app, BrowserWindow, dialog, Display, IpcMainEvent } from 'electron';
import * as path from 'path';
import { captureRegionLinux, destroyCaptureWindowLinux } from './linux-screen-capture';
import { getMainWindow, loadSettings } from './main';
import { resolveLanguage } from './i18n';

const isLinux = process.platform === 'linux';

let composeWindow: BrowserWindow | null = null;

async function ensureComposeWebContents(): Promise<Electron.WebContents> {
  if (composeWindow && !composeWindow.isDestroyed()) {
    return composeWindow.webContents;
  }
  const settings = loadSettings();
  const lang = resolveLanguage(settings.language || 'system', app.getLocale());
  composeWindow = new BrowserWindow({
    show: false,
    transparent: false,
    width: 640,
    height: 480,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await composeWindow.loadFile(path.join(__dirname, '../renderer/capture-window.html'), {
    query: { composeOnly: '1', screenId: '0', totalScreens: '1', lang },
  });
  return composeWindow.webContents;
}

/** Platform-specific capture / dialog / window hooks. All OS checks live here. */
export const platform = {
  isLinux,

  destroyCaptureWindow(win: BrowserWindow): void {
    if (isLinux) destroyCaptureWindowLinux(win);
    else win.close();
  },

  skipsOverlayRestore: isLinux,

  async captureIfLinux(
    areaData: { x: number; y: number; width: number; height: number },
    targetDisplay: Display,
    displays: Display[],
    takeOverlays: () => BrowserWindow[]
  ): Promise<Buffer | null> {
    if (!isLinux) return null;
    return captureRegionLinux(areaData, targetDisplay, displays, { takeOverlays });
  },

  getSaveDialogParent(event: IpcMainEvent): BrowserWindow | null {
    if (isLinux) return null;
    return getMainWindow() ?? BrowserWindow.fromWebContents(event.sender);
  },

  isSaveDialogParentValid(parent: BrowserWindow | null): boolean {
    if (isLinux) return true;
    return !!parent && !parent.isDestroyed();
  },

  showSaveDialog(
    parent: BrowserWindow | null,
    opts: Electron.SaveDialogOptions
  ): Promise<Electron.SaveDialogReturnValue> {
    if (isLinux) return dialog.showSaveDialog(opts);
    return dialog.showSaveDialog(parent!, opts);
  },

  async watermarkSenderId(
    hasAnnotations: boolean,
    screenshotBuffer: Buffer,
    annotations: unknown,
    watermark: unknown
  ): Promise<number | 'overlay'> {
    if (!isLinux) return 'overlay';
    const wc = await ensureComposeWebContents();
    if (hasAnnotations) {
      wc.send('compose-image', { pngBuffer: screenshotBuffer, annotations, watermark });
    } else {
      wc.send('apply-watermark', { pngBuffer: screenshotBuffer, watermark });
    }
    return wc.id;
  },
};
