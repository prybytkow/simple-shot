/**
 * Platform app / tray / notification icons under dist/main/assets.
 */
import { nativeImage, NativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

function assetsDir(): string {
  return path.join(__dirname, 'assets');
}

/** Window / notification icon path (.ico on Windows, .png elsewhere). */
export function appIconPath(): string {
  const dir = assetsDir();
  if (process.platform === 'win32') {
    return path.join(dir, 'icon.ico');
  }
  return path.join(dir, 'icon.png');
}

/** NativeImage for BrowserWindow `icon` (title bar). Prefer this over a bare path. */
export function appWindowIcon(): NativeImage | undefined {
  const p = appIconPath();
  if (!fs.existsSync(p)) return undefined;
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? undefined : img;
}

/** Tray image: macOS template when available, otherwise app icon. */
export function createTrayIcon(): NativeImage {
  const dir = assetsDir();
  if (process.platform === 'darwin') {
    const template = path.join(dir, 'iconTemplate.png');
    if (fs.existsSync(template)) {
      const img = nativeImage.createFromPath(template);
      img.setTemplateImage(true);
      return img;
    }
  }
  const p = appIconPath();
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
}

/** Optional NativeImage for Notification ({ icon }). */
export function createNotifyIcon(): NativeImage | undefined {
  const p = notificationIconPath() || appIconPath();
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}

/**
 * Prefer PNG for toast content (Windows Action Center handles it more reliably than .ico).
 * Falls back to platform app icon path.
 */
export function notificationIconPath(): string | undefined {
  const png = path.join(assetsDir(), 'icon.png');
  if (fs.existsSync(png)) return png;
  const p = appIconPath();
  return fs.existsSync(p) ? p : undefined;
}
