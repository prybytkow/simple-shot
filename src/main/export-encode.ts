/**
 * Filename templates and image encoding (PNG / JPG / WebP) for export.
 */
import { nativeImage, NativeImage } from 'electron';
import { randomBytes } from 'crypto';

export type ExportFormat = 'png' | 'jpg' | 'webp';

export interface FileNameContext {
  date?: Date;
  width: number;
  height: number;
  format: ExportFormat;
  profile: string;
  mode: string;
  timestamp?: number;
  uuid?: string;
}

export interface EncodedImage {
  buffer: Buffer;
  mimeType: string;
  extension: ExportFormat;
}

const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;
const STEM_MAX = 120;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function sanitizeStem(stem: string): string {
  let s = stem.replace(INVALID_CHARS, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > STEM_MAX) s = s.slice(0, STEM_MAX);
  return s;
}

function stripTrailingExtension(stem: string, format: ExportFormat): string {
  const lower = stem.toLowerCase();
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', `.${format}`]) {
    if (lower.endsWith(ext)) {
      return stem.slice(0, -ext.length);
    }
  }
  return stem;
}

export function sanitizeProfileName(name: string): string {
  return sanitizeStem((name || 'profile').replace(/\s+/g, '_')) || 'profile';
}

/** Render template → `stem.ext` (extension always from format). */
export function renderFileName(template: string, ctx: FileNameContext): string {
  const d = ctx.date || new Date();
  const ts = ctx.timestamp ?? Date.now();
  const uuid = ctx.uuid ?? randomBytes(5).toString('hex');
  const format = ctx.format;
  const map: Record<string, string> = {
    '{yyyy}': String(d.getFullYear()),
    '{yy}': String(d.getFullYear()).slice(-2),
    '{MM}': pad2(d.getMonth() + 1),
    '{dd}': pad2(d.getDate()),
    '{HH}': pad2(d.getHours()),
    '{mm}': pad2(d.getMinutes()),
    '{ss}': pad2(d.getSeconds()),
    '{timestamp}': String(ts),
    '{uuid}': uuid,
    '{width}': String(ctx.width),
    '{height}': String(ctx.height),
    '{format}': format,
    '{profile}': sanitizeProfileName(ctx.profile),
    '{mode}': (ctx.mode || 'region').replace(INVALID_CHARS, '_')
  };

  let stem = template || '';
  for (const [token, value] of Object.entries(map)) {
    stem = stem.split(token).join(value);
  }
  stem = stripTrailingExtension(sanitizeStem(stem), format);
  if (!stem) {
    stem = `screenshot-${ts}`;
  }
  return `${stem}.${format}`;
}

/** Stable preview for Settings (fixed clock / size / profile). */
export function previewFileName(
  template: string,
  format: ExportFormat,
  opts?: { profile?: string; mode?: string }
): string {
  return renderFileName(template, {
    date: new Date(2026, 10, 7, 14, 30, 45),
    timestamp: 1730989845000,
    uuid: 'a1b2c3d4e5',
    width: 1920,
    height: 1080,
    format,
    profile: opts?.profile || 'Default',
    mode: opts?.mode || 'region'
  });
}

function toNative(input: Buffer | NativeImage): NativeImage {
  if (Buffer.isBuffer(input)) {
    return nativeImage.createFromBuffer(input);
  }
  return input;
}

async function flattenPngOnWhite(png: Buffer): Promise<Buffer> {
  try {
    const sharp = require('sharp') as typeof import('sharp');
    return await sharp(png)
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();
  } catch {
    return png;
  }
}

export async function encodeImage(
  input: Buffer | NativeImage,
  format: ExportFormat,
  quality: number
): Promise<EncodedImage> {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  let img = toNative(input);
  if (img.isEmpty()) {
    throw new Error('Empty image');
  }

  if (format === 'png') {
    return { buffer: img.toPNG(), mimeType: 'image/png', extension: 'png' };
  }

  if (format === 'jpg') {
    const png = img.toPNG();
    const flat = await flattenPngOnWhite(png);
    img = nativeImage.createFromBuffer(flat);
    return {
      buffer: img.toJPEG(q),
      mimeType: 'image/jpeg',
      extension: 'jpg'
    };
  }

  const anyImg = img as NativeImage & {
    toWebp?: (quality: number) => Buffer;
    toWebP?: (quality: number) => Buffer;
  };
  if (typeof anyImg.toWebP === 'function') {
    return { buffer: anyImg.toWebP(q), mimeType: 'image/webp', extension: 'webp' };
  }
  if (typeof anyImg.toWebp === 'function') {
    return { buffer: anyImg.toWebp(q), mimeType: 'image/webp', extension: 'webp' };
  }

  const sharp = require('sharp') as typeof import('sharp');
  const png = img.toPNG();
  const buffer = await sharp(png).webp({ quality: q }).toBuffer();
  return { buffer, mimeType: 'image/webp', extension: 'webp' };
}

export function mimeForFormat(format: ExportFormat): string {
  if (format === 'jpg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

export function mimeFromExtension(ext: string): string {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'webp') return 'image/webp';
  return 'image/png';
}
