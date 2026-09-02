import { BrowserWindow, nativeImage, Display } from 'electron';
import * as dbus from 'dbus-next';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { getMainWindow } from './main';

const { Variant } = dbus;

export interface LinuxCaptureHooks {
  takeOverlays: () => BrowserWindow[];
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Full desktop via xdg-desktop-portal Screenshot (Wayland-safe). */
async function portalScreenshot(): Promise<Buffer> {
  const bus = dbus.sessionBus();
  const desktop = await bus.getProxyObject(
    'org.freedesktop.portal.Desktop',
    '/org/freedesktop/portal/desktop'
  );
  const screenshot = desktop.getInterface('org.freedesktop.portal.Screenshot');

  const handlePath = await screenshot.Screenshot('wayland:', {
    handle_token: new Variant('s', `simpleshot_${Date.now()}`),
    interactive: new Variant('b', false),
  });

  const request = (await bus.getProxyObject(
    'org.freedesktop.portal.Desktop',
    handlePath
  )).getInterface('org.freedesktop.portal.Request');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Portal screenshot timed out')), 30_000);
    request.once('Response', (status: number, results: Record<string, dbus.Variant>) => {
      clearTimeout(timer);
      if (status !== 0) {
        reject(new Error('Screenshot cancelled or failed'));
        return;
      }
      const uri = results.uri?.value as string | undefined;
      if (!uri) {
        reject(new Error('Portal screenshot returned no image'));
        return;
      }
      try {
        const filePath = fileURLToPath(uri);
        const buf = fs.readFileSync(filePath);
        try { fs.unlinkSync(filePath); } catch { /* temp file may already be gone */ }
        resolve(buf);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function cropToSelection(
  fullPng: Buffer,
  area: { x: number; y: number; width: number; height: number },
  display: Display,
  displays: Display[]
): Buffer {
  const image = nativeImage.createFromBuffer(fullPng);
  const { width, height } = image.getSize();
  if (!width || !height) throw new Error('Portal screenshot is empty');

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }

  const scaleX = width / (maxX - minX);
  const scaleY = height / (maxY - minY);
  const x = Math.round((display.bounds.x - minX + area.x) * scaleX);
  const y = Math.round((display.bounds.y - minY + area.y) * scaleY);
  const w = Math.round(area.width * scaleX);
  const h = Math.round(area.height * scaleY);

  const cropX = Math.max(0, Math.min(x, width - 1));
  const cropY = Math.max(0, Math.min(y, height - 1));
  const cropW = Math.max(1, Math.min(w, width - cropX));
  const cropH = Math.max(1, Math.min(h, height - cropY));

  return image.crop({ x: cropX, y: cropY, width: cropW, height: cropH }).toPNG();
}

async function hideOverlaysForCapture(overlays: BrowserWindow[]): Promise<void> {
  for (const win of overlays) {
    if (!win.isDestroyed()) win.hide();
  }
  const main = getMainWindow();
  if (main && !main.isDestroyed()) main.hide();

  await sleep(250);

  for (const win of overlays) {
    if (!win.isDestroyed()) win.destroy();
  }
  await sleep(150);
}

export async function captureRegionLinux(
  areaData: { x: number; y: number; width: number; height: number },
  targetDisplay: Display,
  displays: Display[],
  hooks: LinuxCaptureHooks
): Promise<Buffer> {
  await hideOverlaysForCapture(hooks.takeOverlays());
  return cropToSelection(await portalScreenshot(), areaData, targetDisplay, displays);
}

/** Wayland-safe overlay teardown (deferred destroy avoids SIGTRAP). */
export function destroyCaptureWindowLinux(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.hide();
  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, 0);
}
