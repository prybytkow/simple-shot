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
  const p = appIconPath();
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}
