/**
 * Capture history v2: metadata in history.json + thumbs/full frames in history-media/.
 */
import { app, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';

export type HistoryMethod = 'ssh' | 'ftp' | 's3' | 'api' | 'local' | 'clipboard' | 'file';
export type HistorySource = 'capture' | 'drop' | 'reedit';
export type HistoryFormat = 'png' | 'jpg' | 'webp';

export interface HistoryEntry {
  id: string;
  method: HistoryMethod;
  urlOrPath: string;
  date: string;
  fileName?: string;
  width?: number;
  height?: number;
  format?: HistoryFormat;
  profileId?: string;
  profileName?: string;
  /** Relative filename under history-media/ (e.g. {id}.thumb.jpg) */
  thumbPath?: string;
  /** Absolute path or relative under history-media/ for full frame */
  imagePath?: string;
  source?: HistorySource;
  note?: string;
}

/** Entry as sent to the renderer (includes file:// thumb URL). */
export interface HistoryEntryForUi extends HistoryEntry {
  thumbUrl?: string;
  canReedit: boolean;
  canReveal: boolean;
  canOpenUrl: boolean;
}

export interface RecordCaptureOptions {
  buffer: Buffer;
  method: HistoryMethod;
  urlOrPath: string;
  fileName?: string;
  format?: HistoryFormat;
  profileId?: string;
  profileName?: string;
  source?: HistorySource;
  /** When set, use this as imagePath and skip writing full duplicate (local save). */
  localImagePath?: string;
  /** Store full PNG in media (default true except when localImagePath set). */
  storeFull?: boolean;
}

const MAX_ENTRIES = 100;
const FULL_KEEP = 30;
const THUMB_MAX = 240;
const THUMB_QUALITY = 70;

function getHistoryPath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

export function getMediaDir(): string {
  return path.join(app.getPath('userData'), 'history-media');
}

function ensureMediaDir(): void {
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function absoluteMediaPath(relOrAbs: string): string {
  if (!relOrAbs) return '';
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(getMediaDir(), relOrAbs);
}

function mapLegacyMethod(raw: string): HistoryMethod {
  const m = (raw || '').trim();
  const lower = m.toLowerCase();
  if (lower === 's3') return 's3';
  if (lower === 'ftp') return 'ftp';
  if (lower === 'ssh') return 'ssh';
  if (lower === 'api') return 'api';
  if (lower === 'clipboard') return 'clipboard';
  if (lower === 'file') return 'file';
  if (lower === 'local' || m === 'Локально' || lower === 'locally') return 'local';
  return 'local';
}

export function normalizeEntry(raw: any): HistoryEntry {
  const id = typeof raw?.id === 'string' && raw.id ? raw.id : randomUUID();
  const method =
    raw?.method === 'ssh' ||
    raw?.method === 'ftp' ||
    raw?.method === 's3' ||
    raw?.method === 'api' ||
    raw?.method === 'local' ||
    raw?.method === 'clipboard' ||
    raw?.method === 'file'
      ? (raw.method as HistoryMethod)
      : mapLegacyMethod(String(raw?.method || 'local'));

  const format =
    raw?.format === 'jpg' || raw?.format === 'webp' || raw?.format === 'png'
      ? raw.format
      : undefined;

  const source =
    raw?.source === 'drop' || raw?.source === 'reedit' || raw?.source === 'capture'
      ? raw.source
      : 'capture';

  return {
    id,
    method,
    urlOrPath: typeof raw?.urlOrPath === 'string' ? raw.urlOrPath : '',
    date: typeof raw?.date === 'string' && raw.date ? raw.date : new Date().toISOString(),
    fileName: typeof raw?.fileName === 'string' ? raw.fileName : undefined,
    width: typeof raw?.width === 'number' ? raw.width : undefined,
    height: typeof raw?.height === 'number' ? raw.height : undefined,
    format,
    profileId: typeof raw?.profileId === 'string' ? raw.profileId : undefined,
    profileName: typeof raw?.profileName === 'string' ? raw.profileName : undefined,
    thumbPath: typeof raw?.thumbPath === 'string' ? raw.thumbPath : undefined,
    imagePath: typeof raw?.imagePath === 'string' ? raw.imagePath : undefined,
    source,
    note: typeof raw?.note === 'string' ? raw.note : undefined
  };
}

function resolveImageFile(entry: HistoryEntry): string | null {
  const candidates: string[] = [];
  if (entry.imagePath) candidates.push(absoluteMediaPath(entry.imagePath));
  if (
    (entry.method === 'local' || entry.method === 'file') &&
    entry.urlOrPath &&
    !/^https?:\/\//i.test(entry.urlOrPath)
  ) {
    candidates.push(entry.urlOrPath);
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

export function entryCanReedit(entry: HistoryEntry): boolean {
  return resolveImageFile(entry) != null;
}

function enrichForUi(entry: HistoryEntry): HistoryEntryForUi {
  let thumbUrl: string | undefined;
  if (entry.thumbPath) {
    const abs = absoluteMediaPath(entry.thumbPath);
    if (fs.existsSync(abs)) {
      thumbUrl = pathToFileURL(abs).href;
    }
  }
  const imageFile = resolveImageFile(entry);
  const isHttp = /^https?:\/\//i.test(entry.urlOrPath || '');
  const isLocalPath =
    !!entry.urlOrPath &&
    !isHttp &&
    fs.existsSync(entry.urlOrPath);
  return {
    ...entry,
    thumbUrl,
    canReedit: !!imageFile,
    canReveal: isLocalPath || (!!imageFile && !isHttp),
    canOpenUrl: isHttp || isLocalPath
  };
}

export function loadHistory(): HistoryEntry[] {
  try {
    const p = getHistoryPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!Array.isArray(data)) return [];
      return data.map(normalizeEntry);
    }
  } catch (e) {
    console.error('Error loading history:', e);
  }
  return [];
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    fs.writeFileSync(getHistoryPath(), JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2));
  } catch (e) {
    console.error('Error saving history:', e);
  }
}

export function deleteEntryMedia(entry: HistoryEntry): void {
  const dir = getMediaDir();
  const names = [`${entry.id}.thumb.jpg`, `${entry.id}.png`, `${entry.id}.jpg`, `${entry.id}.webp`];
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      console.error('Error deleting media', p, e);
    }
  }
  // Relative thumb/image under media dir only
  if (entry.thumbPath && !path.isAbsolute(entry.thumbPath)) {
    const p = absoluteMediaPath(entry.thumbPath);
    try {
      if (fs.existsSync(p) && path.dirname(p) === dir) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  if (entry.imagePath && !path.isAbsolute(entry.imagePath)) {
    const p = absoluteMediaPath(entry.imagePath);
    try {
      if (fs.existsSync(p) && path.dirname(p) === dir) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/** Keep full frames only for the newest FULL_KEEP entries that store media copies. */
export function pruneFullImages(list: HistoryEntry[]): HistoryEntry[] {
  ensureMediaDir();
  let fullCount = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const relFull =
      e.imagePath && !path.isAbsolute(e.imagePath) ? e.imagePath : null;
    const mediaFull =
      relFull ||
      (e.imagePath && e.imagePath.startsWith(getMediaDir()) ? e.imagePath : null);

    // Only prune copies inside history-media (not user local saves)
    const inMedia =
      !!e.imagePath &&
      (e.imagePath === `${e.id}.png` ||
        e.imagePath === `${e.id}.jpg` ||
        e.imagePath === `${e.id}.webp` ||
        (!path.isAbsolute(e.imagePath) && e.imagePath.startsWith(e.id)) ||
        (path.isAbsolute(e.imagePath) && e.imagePath.startsWith(getMediaDir())));

    if (!inMedia) continue;

    fullCount++;
    if (fullCount > FULL_KEEP) {
      const abs = absoluteMediaPath(e.imagePath!);
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (err) {
        console.error(err);
      }
      list[i] = { ...e, imagePath: undefined };
    }
  }
  return list;
}

async function writeThumb(id: string, pngBuffer: Buffer): Promise<{ rel: string; width: number; height: number }> {
  ensureMediaDir();
  const rel = `${id}.thumb.jpg`;
  const abs = path.join(getMediaDir(), rel);
  const img = nativeImage.createFromBuffer(pngBuffer);
  const size = img.getSize();
  let width = size.width || 0;
  let height = size.height || 0;

  try {
    const sharp = require('sharp') as typeof import('sharp');
    await sharp(pngBuffer)
      .resize({
        width: THUMB_MAX,
        height: THUMB_MAX,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: THUMB_QUALITY })
      .toFile(abs);
  } catch (e) {
    console.error('Thumb sharp failed, fallback JPEG', e);
    const maxSide = Math.max(width || 1, height || 1);
    const scale = maxSide > THUMB_MAX ? THUMB_MAX / maxSide : 1;
    const resized = img.resize({
      width: Math.max(1, Math.round((width || THUMB_MAX) * scale)),
      height: Math.max(1, Math.round((height || THUMB_MAX) * scale))
    });
    fs.writeFileSync(abs, resized.toJPEG(THUMB_QUALITY));
  }
  return { rel, width, height };
}

async function writeFullPng(id: string, pngBuffer: Buffer): Promise<string> {
  ensureMediaDir();
  const rel = `${id}.png`;
  fs.writeFileSync(path.join(getMediaDir(), rel), pngBuffer);
  return rel;
}

/**
 * Persist a capture into history with thumb (+ optional full frame).
 * Safe to call from upload/save/clipboard/drop paths.
 */
export async function recordCaptureToHistory(opts: RecordCaptureOptions): Promise<HistoryEntry> {
  const id = randomUUID();
  const source = opts.source || 'capture';
  const format = opts.format || 'png';

  const hasPixels = opts.buffer && opts.buffer.length > 32;

  let thumbPath: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  if (hasPixels) {
    try {
      const thumb = await writeThumb(id, opts.buffer);
      thumbPath = thumb.rel;
      width = thumb.width || undefined;
      height = thumb.height || undefined;
    } catch (e) {
      console.error('Failed to write history thumb', e);
    }
  }

  let imagePath: string | undefined;
  if (opts.localImagePath) {
    imagePath = opts.localImagePath;
  } else if (opts.storeFull !== false && hasPixels) {
    try {
      imagePath = await writeFullPng(id, opts.buffer);
    } catch (e) {
      console.error('Failed to write history full image', e);
    }
  }

  const entry: HistoryEntry = {
    id,
    method: opts.method,
    urlOrPath: opts.urlOrPath || '',
    date: new Date().toISOString(),
    fileName: opts.fileName,
    width,
    height,
    format,
    profileId: opts.profileId,
    profileName: opts.profileName,
    thumbPath,
    imagePath,
    source
  };

  let list = loadHistory();
  list.unshift(entry);
  // Drop media for entries beyond max before prune
  const dropped = list.slice(MAX_ENTRIES);
  list = list.slice(0, MAX_ENTRIES);
  for (const d of dropped) deleteEntryMedia(d);
  list = pruneFullImages(list);
  saveHistory(list);
  return entry;
}

/** @deprecated use recordCaptureToHistory — kept for simple text-only fallbacks */
export function addToHistory(entry: {
  method: string;
  urlOrPath: string;
  fileName?: string;
}): void {
  void recordCaptureToHistory({
    buffer: Buffer.alloc(0),
    method: mapLegacyMethod(entry.method),
    urlOrPath: entry.urlOrPath,
    fileName: entry.fileName,
    storeFull: false
  }).catch((e) => console.error(e));
}

export function getHistory(): HistoryEntry[] {
  return loadHistory();
}

export function getHistoryForUi(): HistoryEntryForUi[] {
  return loadHistory().map(enrichForUi);
}

export function deleteHistoryEntry(id: string): { ok: boolean } {
  const list = loadHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false };
  const [removed] = list.splice(idx, 1);
  deleteEntryMedia(removed);
  saveHistory(list);
  return { ok: true };
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return loadHistory().find((e) => e.id === id);
}

export function resolveReeditPath(id: string): string | null {
  const entry = getHistoryEntry(id);
  if (!entry) return null;
  return resolveImageFile(entry);
}

export function resolveRevealPath(id: string): string | null {
  const entry = getHistoryEntry(id);
  if (!entry) return null;
  if (entry.urlOrPath && !/^https?:\/\//i.test(entry.urlOrPath) && fs.existsSync(entry.urlOrPath)) {
    return entry.urlOrPath;
  }
  return resolveImageFile(entry);
}
