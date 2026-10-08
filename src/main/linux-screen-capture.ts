/**
 * Wayland screenshot via xdg-desktop-portal (gdbus). Loaded only on Linux.
 * X11 keeps using desktopCapturer in screen-capture.ts.
 */
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { nativeImage } from 'electron';

const execFileAsync = promisify(execFile);

export function isWaylandSession(): boolean {
  const session = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  if (session === 'wayland') return true;
  if (session === 'x11') return false;
  return Boolean(process.env.WAYLAND_DISPLAY) && !process.env.DISPLAY;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePortalResponse(
  log: string,
  requestPath: string
): { status: number; uri?: string } | null {
  const escaped = requestPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = log.match(
    new RegExp(
      escaped + "[\\s\\S]*?Response\\s*\\(\\s*uint32\\s+(\\d+)\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)"
    )
  );
  if (!match) return null;
  const uriMatch = match[2].match(/uri['"]?\s*:\s*<\s*['"]([^'"]+)['"]/);
  return { status: Number(match[1]), uri: uriMatch?.[1] };
}

async function waitForPortalUri(logRef: { text: string }, requestPath: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const parsed = parsePortalResponse(logRef.text, requestPath);
    if (parsed) {
      if (parsed.status !== 0 || !parsed.uri) {
        throw new Error(`Portal screenshot failed (status ${parsed.status})`);
      }
      return parsed.uri;
    }
    await sleep(40);
  }
  throw new Error('Portal screenshot timed out');
}

function uriToPath(uri: string): string {
  if (uri.startsWith('file:')) return fileURLToPath(uri);
  return uri;
}

/** Full desktop PNG. Caller crops to the selection. */
async function portalScreenshot(): Promise<Buffer> {
  const token = `simpleshot${Date.now()}`;
  const logRef = { text: '' };
  const monitor = spawn('gdbus', [
    'monitor', '--session',
    '--dest', 'org.freedesktop.portal.Desktop'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const append = (chunk: Buffer) => {
    logRef.text += chunk.toString();
  };
  monitor.stdout?.on('data', append);
  monitor.stderr?.on('data', append);

  let spawnError: Error | null = null;
  monitor.once('error', (err: Error) => {
    spawnError = err;
  });

  try {
    let monitoring = false;
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (spawnError) throw spawnError;
      if (/Monitoring signals/i.test(logRef.text)) {
        monitoring = true;
        break;
      }
      await sleep(30);
    }
    if (spawnError) throw spawnError;
    if (!monitoring) throw new Error('Portal monitor did not start');

    const { stdout } = await execFileAsync('gdbus', [
      'call', '--session',
      '--dest', 'org.freedesktop.portal.Desktop',
      '--object-path', '/org/freedesktop/portal/desktop',
      '--method', 'org.freedesktop.portal.Screenshot.Screenshot',
      '',
      `{'interactive': <false>, 'handle_token': <'${token}'>}`
    ], { timeout: 20000, encoding: 'utf8' });

    const pathMatch = stdout.match(/objectpath\s+'([^']+)'|objectpath\s+"([^"]+)"/);
    const requestPath = pathMatch?.[1] || pathMatch?.[2];
    if (!requestPath) {
      throw new Error(`Portal screenshot returned no request path: ${stdout.trim()}`);
    }

    const uri = await waitForPortalUri(logRef, requestPath, 30000);
    const filePath = uriToPath(uri);
    const buf = fs.readFileSync(filePath);
    try { fs.unlinkSync(filePath); } catch { /* temp file may already be gone */ }
    return buf;
  } finally {
    if (!monitor.killed) monitor.kill();
  }
}

/**
 * Map the selection onto the portal image.
 * One scale for the whole virtual desktop — mixed-DPI monitors can shift the crop.
 */
function cropToSelection(
  fullPng: Buffer,
  area: { x: number; y: number; width: number; height: number },
  display: Electron.Display,
  displays: Electron.Display[]
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

  const desktopW = maxX - minX;
  const desktopH = maxY - minY;
  const scaleX = desktopW > 0 ? width / desktopW : 1;
  const scaleY = desktopH > 0 ? height / desktopH : 1;
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

export async function captureRegionLinux(
  area: { x: number; y: number; width: number; height: number },
  display: Electron.Display,
  displays: Electron.Display[]
): Promise<Buffer> {
  return cropToSelection(await portalScreenshot(), area, display, displays);
}
