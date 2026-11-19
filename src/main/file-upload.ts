/**
 * Upload arbitrary user files (drag-drop / file picker) via active upload profile.
 */
import { app, clipboard, dialog, ipcMain, BrowserWindow, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getRuntimeUploadSettings, loadAppSettings, getActiveProfile } from './settings-store';
import { resolveLanguage, getTranslations } from './i18n';
import { recordCaptureToHistory, HistoryFormat } from './history';
import { uploadBySaveMethod } from './uploaders/dispatch';
import { buildPublicUrl, historyMethodFromSaveMethod } from './upload-url';
import { showAppNotification } from './app-notify';

type FileUploadHooks = {
  ensureVaultUnlockedForUpload: () => boolean;
  getUploadWindowParent: () => BrowserWindow | null;
};

let hooks: FileUploadHooks | null = null;

const MAX_FILES = 20;
const MAX_SIZE_WARN = 100 * 1024 * 1024;
const CONCURRENCY = 2;
const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

export type UploadFileStatus = 'queued' | 'uploading' | 'done' | 'error' | 'skipped';

export interface UploadProgressPayload {
  path: string;
  fileName: string;
  status: UploadFileStatus;
  url?: string;
  error?: string;
  index: number;
  total: number;
  warnSize?: boolean;
}

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/typescript',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

export function guessMime(fileName: string): string {
  const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

export function sanitizeUploadFileName(name: string): string {
  const base = path.basename(name || 'file');
  const cleaned = base.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim() || 'file';
  return cleaned.slice(0, 180);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const sanitized = sanitizeUploadFileName(raw);
    const ext = path.extname(sanitized);
    const stem = ext ? sanitized.slice(0, -ext.length) : sanitized;
    const key = sanitized.toLowerCase();
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n === 0) return sanitized;
    return `${stem}-${n}${ext}`;
  });
}

function historyFormat(fileName: string, mime: string): HistoryFormat | undefined {
  if (mime.startsWith('image/')) {
    const ext = path.extname(fileName).replace(/^\./, '').toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
    if (ext === 'webp') return 'webp';
    if (ext === 'png') return 'png';
  }
  return undefined;
}

export async function uploadUserFile(
  filePath: string,
  settings: any,
  uploadFileName?: string
): Promise<{ url: string; fileName: string }> {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error('not_a_file');
  }
  const fileName = uploadFileName || sanitizeUploadFileName(path.basename(filePath));
  const mime = guessMime(fileName);
  const buffer = fs.readFileSync(filePath);

  const result = await uploadBySaveMethod(
    settings.saveMethod,
    buffer,
    fileName,
    settings,
    mime
  );

  const url = buildPublicUrl(result, settings, fileName);
  const isImage = mime.startsWith('image/');
  const profile = getActiveProfile();
  try {
    await recordCaptureToHistory({
      buffer: isImage ? buffer : Buffer.alloc(0),
      method: historyMethodFromSaveMethod(settings.saveMethod),
      urlOrPath: url,
      fileName,
      format: historyFormat(fileName, mime),
      profileId: profile?.id,
      profileName: profile?.name,
      source: 'drop',
      storeFull: isImage
    });
  } catch (e) {
    console.error('history record for drop failed', e);
  }

  return { url, fileName };
}

function sendProgress(sender: WebContents | null, payload: UploadProgressPayload): void {
  if (sender && !sender.isDestroyed()) {
    sender.send('upload-files-progress', payload);
  }
}

function notifyDone(title: string, body: string): void {
  showAppNotification({ title, body, openUrl: /^https?:\/\//i.test(body) ? body : undefined });
}

export async function startUploadQueue(
  paths: string[],
  sender: WebContents | null
): Promise<{ ok: boolean; uploaded: number; failed: number; lastUrl?: string; error?: string }> {
  const runtime = getRuntimeUploadSettings();
  if ('error' in runtime) {
    if (runtime.error === 'locked') {
      hooks?.ensureVaultUnlockedForUpload();
      const appS = loadAppSettings();
      const lang = resolveLanguage(appS.language || 'system', app.getLocale());
      const tr = getTranslations(lang as any);
      return { ok: false, uploaded: 0, failed: 0, error: tr.vault_errLocked || 'Unlock the vault first' };
    }
    return { ok: false, uploaded: 0, failed: 0, error: 'no_profile' };
  }

  const files: { path: string; name: string; size: number; warnSize: boolean }[] = [];
  for (const p of paths.slice(0, MAX_FILES)) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        sendProgress(sender, {
          path: p,
          fileName: path.basename(p),
          status: 'skipped',
          error: 'folder',
          index: 0,
          total: 0
        });
        continue;
      }
      if (!st.isFile()) continue;
      files.push({
        path: p,
        name: path.basename(p),
        size: st.size,
        warnSize: st.size > MAX_SIZE_WARN
      });
    } catch {
      /* skip missing */
    }
  }

  if (files.length === 0) {
    return { ok: false, uploaded: 0, failed: 0, error: 'no_files' };
  }

  const unique = uniqueNames(files.map((f) => f.name));
  const total = files.length;
  let uploaded = 0;
  let failed = 0;
  let lastUrl: string | undefined;
  let cursor = 0;

  const worker = async () => {
    while (cursor < files.length) {
      const i = cursor++;
      const item = files[i];
      const fileName = unique[i];
      sendProgress(sender, {
        path: item.path,
        fileName,
        status: 'uploading',
        index: i,
        total,
        warnSize: item.warnSize
      });
      try {
        const { url } = await uploadUserFile(item.path, runtime, fileName);
        uploaded++;
        lastUrl = url;
        sendProgress(sender, {
          path: item.path,
          fileName,
          status: 'done',
          url,
          index: i,
          total,
          warnSize: item.warnSize
        });
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        sendProgress(sender, {
          path: item.path,
          fileName,
          status: 'error',
          error: msg,
          index: i,
          total,
          warnSize: item.warnSize
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker());
  await Promise.all(workers);

  if (lastUrl) {
    await clipboard.writeText(lastUrl);
  }

  const appS = loadAppSettings();
  const lang = resolveLanguage(appS.language || 'system', app.getLocale());
  const tr = getTranslations(lang as any);
  if (lastUrl && appS.afterUploadFeedback === 'notification') {
    notifyDone(tr.notify_linkCopiedTitle || 'Link copied', lastUrl);
  }

  if (sender && !sender.isDestroyed()) {
    sender.send('upload-files-done', { uploaded, failed, lastUrl, total });
  }

  return { ok: failed === 0 && uploaded > 0, uploaded, failed, lastUrl };
}

let ipcRegistered = false;

export function registerFileUploadIpc(h: FileUploadHooks & { getUploadWindow: () => BrowserWindow | null }): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  hooks = h;

  ipcMain.handle('pick-upload-files', async () => {
    const parent = h.getUploadWindowParent();
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All files', extensions: ['*'] }]
    };
    const result =
      process.platform === 'linux' || !parent || parent.isDestroyed()
        ? await dialog.showOpenDialog(opts)
        : await dialog.showOpenDialog(parent, opts);
    if (result.canceled || !result.filePaths?.length) return { paths: [] as string[] };
    return { paths: result.filePaths.slice(0, MAX_FILES) };
  });

  ipcMain.handle('upload-files', async (event, payload: { paths?: string[] }) => {
    const paths = Array.isArray(payload?.paths) ? payload.paths.filter((p) => typeof p === 'string') : [];
    return startUploadQueue(paths.slice(0, MAX_FILES), event.sender);
  });

  /** File size / directory check for upload UI (renderer has no fs). */
  ipcMain.handle('stat-upload-paths', (_e, payload: { paths?: string[] }) => {
    const paths = Array.isArray(payload?.paths) ? payload.paths.filter((p) => typeof p === 'string') : [];
    return paths.slice(0, MAX_FILES).map((filePath) => {
      try {
        const st = fs.statSync(filePath);
        return {
          path: filePath,
          name: path.basename(filePath),
          size: st.size,
          isDirectory: st.isDirectory(),
          warnSize: st.size > 100 * 1024 * 1024
        };
      } catch {
        return {
          path: filePath,
          name: path.basename(filePath),
          size: 0,
          isDirectory: false,
          warnSize: false,
          missing: true
        };
      }
    });
  });
}
